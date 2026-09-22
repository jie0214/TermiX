export interface SFTPSession { id: string; hostId: string; path: string }
export interface SFTPEntry { name: string; type: 'file' | 'directory' | 'symlink' | 'special'; size: number; modified: number; permissions: string }
export interface SFTPListing { path: string; entries: SFTPEntry[] }
export interface SFTPTransfer {
  id: string; sessionId: string; hostId: string; name: string;
  direction: 'upload' | 'download'; status: 'queued' | 'running' | 'completed' | 'failed';
  bytes: number; total: number; speed: number; error: string;
}

export interface SFTPLocalEntry extends SFTPEntry { path: string }
export interface SFTPLocalListing { path: string; parent: string; entries: SFTPLocalEntry[] }
