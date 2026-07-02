import { TerminalAPI } from '../terminal/TerminalAPI';
import { terminalStore } from '../terminal/TerminalStore';
import { snippetStore, toTerminalPayload } from './SnippetStore';
import { SnippetAPI } from './SnippetAPI';
import { t } from '../../i18n/index.ts';

export function isLocalSession(session) {
  return !!(session?.isLocal || session?.config?.isLocal);
}

export async function pasteSnippetToSession(sessionKey, snippet) {
  if (!sessionKey || !snippet?.script) {
    return { success: false, error: t('misc.snippet.sessionNotFound') };
  }
  await TerminalAPI.writeTerminalInput(sessionKey, toTerminalPayload(snippet.script, 'paste'));
  return { success: true };
}

export async function runSnippetInSession(sessionKey, snippet) {
  if (!sessionKey || !snippet?.script) {
    return { success: false, error: t('misc.snippet.sessionNotFound') };
  }
  const cmd = snippet.script.endsWith('\n') ? snippet.script : (snippet.script + '\n');
  await TerminalAPI.writeTerminalInput(sessionKey, cmd);
  return { success: true };
}

export async function runStartupSnippets(sessionKey, startupSnippetIds = []) {
  const ids = Array.isArray(startupSnippetIds) ? startupSnippetIds.filter(Boolean) : [];
  if (ids.length === 0) return [];
  const snippets = snippetStore.getState().snippets.filter(snippet => ids.includes(snippet.id));
  const results = [];
  for (const snippet of snippets) {
    results.push(await runSnippetInSession(sessionKey, snippet));
  }
  return results;
}

export function getHostSnippetTargets(snippet, hosts = []) {
  const savedIds = Array.isArray(snippet?.targetHostIds) ? snippet.targetHostIds : [];
  return hosts.filter(host => savedIds.includes(host.id));
}

export async function runStartupCommand(sessionKey, config = {}) {
  const command = SnippetAPI.resolveStartupCommand(config);
  if (!command) return { success: true, skipped: true };
  const cmd = command.endsWith('\n') ? command : (command + '\n');
  await TerminalAPI.writeTerminalInput(sessionKey, cmd);
  return { success: true };
}
