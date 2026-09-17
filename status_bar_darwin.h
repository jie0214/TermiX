#ifndef TERMIX_STATUS_BAR_H
#define TERMIX_STATUS_BAR_H
void TermixUpdateStatusBar(const char *json);
void TermixRemoveStatusBar(void);
void TermixStatusBarShowError(const char *message);
void TermixStatusBarDisconnect(char *kind, char *identifier);
#endif
