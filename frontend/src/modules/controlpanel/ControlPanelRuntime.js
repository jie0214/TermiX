import { ControlPanelAPI } from './ControlPanelAPI';
import { TerminalAPI } from '../terminal/TerminalAPI';
import { t } from '../../i18n/index.ts';

const EXPORT_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function stripAnsi(input) {
  return String(input || '').replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim();
}

export function parseExportVarNames(exportVars) {
  return String(exportVars || '')
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter((name) => EXPORT_VAR_NAME_RE.test(name));
}

export function buildLocalCommandEnv(exportVars, remoteOutput) {
  const names = parseExportVarNames(exportVars);
  if (names.length === 0) return {};

  const env = {};
  const output = stripAnsi(remoteOutput);
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const keyedValues = {};

  try {
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      names.forEach((name) => {
        if (Object.prototype.hasOwnProperty.call(parsed, name)) {
          env[name] = String(parsed[name]);
        }
      });
      return env;
    }
  } catch (err) {
    // 非 JSON 輸出時改用 KEY=VALUE 解析。
  }

  lines.forEach((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      keyedValues[match[1]] = match[2].trim();
    }
  });

  names.forEach((name, index) => {
    if (Object.prototype.hasOwnProperty.call(keyedValues, name)) {
      env[name] = keyedValues[name];
    }
  });

  if (names.length === 1 && Object.keys(env).length === 0 && lines.length === 1 && !lines[0].includes('=')) {
    env[names[0]] = lines[0];
  }

  return env;
}

export function applyEnvToLocalCommand(command, env) {
  let nextCommand = String(command || '');
  Object.entries(env || {}).forEach(([key, value]) => {
    const safeValue = String(value);
    nextCommand = nextCommand
      .replaceAll(`{{${key}}}`, safeValue)
      .replaceAll(`\${${key}}`, safeValue)
      .replace(new RegExp(`\\$${key}\\b`, 'g'), safeValue);
  });
  return nextCommand;
}

export async function executeFunctionBox(comp, sessionKey) {
  const remoteCommand = String(comp.remoteCommand || '').trim();
  const localCommand = String(comp.localCommand || '').trim();
  let remoteResult = null;
  let localResult = null;
  let localEnv = {};

  if (remoteCommand) {
    remoteResult = await TerminalAPI.executeSessionCommandIsolated(sessionKey, remoteCommand);
    if (!remoteResult.success) {
      return {
        success: false,
        phase: 'remote',
        remoteResult,
        error: remoteResult.error || t('cp.err.remoteFailed')
      };
    }
    localEnv = buildLocalCommandEnv(comp.exportVars, remoteResult.output);
    const requiredVars = parseExportVarNames(comp.exportVars);
    const missingVars = requiredVars.filter((name) => !Object.prototype.hasOwnProperty.call(localEnv, name));
    if (localCommand && missingVars.length > 0) {
      return {
        success: false,
        phase: 'export',
        remoteResult,
        localEnv,
        error: t('cp.err.missingVars', { vars: missingVars.join(', ') })
      };
    }
  }

  if (localCommand) {
    const resolvedLocalCommand = applyEnvToLocalCommand(localCommand, localEnv);
    localResult = await ControlPanelAPI.executeLocalCommand(resolvedLocalCommand, localEnv);
    if (!localResult.success) {
      return {
        success: false,
        phase: 'local',
        remoteResult,
        localResult,
        localEnv,
        error: localResult.error || t('cp.err.localFailed')
      };
    }
  }

  return {
    success: true,
    remoteResult,
    localResult,
    localEnv
  };
}
