// @ts-check
// @ts-ignore -- 專案測試以 `readFileSync` 讀取本檔並斷言含 `.ts` 副檔名的 import；此處僅抑制 TS5097，不改變執行期行為。
import { requireAppBinding } from '../../platform/wails/bindings.ts';

/**
 * @typedef {import('../../domain').OperationResult} OperationResult
 */

export const ControlPanelAPI = {
  /**
   * @param {string} command
   * @param {Record<string, string>} env
   * @returns {Promise<OperationResult>}
   */
  executeLocalCommand: (command, env) =>
    requireAppBinding('ExecuteLocalCommand')(command, env),
  /**
   * @param {string} filename
   * @param {string} data
   * @param {string} format
   * @returns {Promise<OperationResult>}
   */
  saveBackupFile: (filename, data, format) =>
    requireAppBinding('SaveBackupFile')(filename, data, format),
  /**
   * @param {string} format
   * @returns {Promise<OperationResult>}
   */
  readBackupFile: (format) =>
    requireAppBinding('ReadBackupFile')(format)
};
