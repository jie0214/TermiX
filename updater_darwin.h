void TermixStartUpdater(void);
void TermixCheckUpdates(void);
void TermixUpdateSettings(void);
void TermixFinishQuit(void);
int TermixConfirmUpdate(char *message);
void TermixPendingUpdate(void);
extern int TermixMayInstallUpdate(void);
extern void TermixUpdaterReady(void);
extern void TermixUpdateAborted(void);

extern void TermixUpdateFound(char *version);

extern void TermixDownloadProgress(char *version, char *status, unsigned long long received, unsigned long long total);
