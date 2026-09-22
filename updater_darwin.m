#import <Cocoa/Cocoa.h>
#import "updater_darwin.h"

// 僅宣告使用中的穩定 API，透過 App 內的 framework 載入；一般開發建置不需下載 Sparkle。
@protocol TXUpdater
@property BOOL automaticallyChecksForUpdates;
@property BOOL automaticallyDownloadsUpdates;
- (void)checkForUpdatesInBackground;
@end
@protocol TXUpdaterController
- (id)initWithStartingUpdater:(BOOL)start updaterDelegate:(id)delegate userDriverDelegate:(id)driver;
- (void)startUpdater;
- (void)checkForUpdates:(id)sender;
- (id<TXUpdater>)updater;
@end
// Sparkle 2 穩定列舉值；維持開發建置不依賴 framework headers。
typedef NS_ENUM(NSInteger, TXUpdateChoice) { TXUpdateChoiceSkip = 0, TXUpdateChoiceInstall = 1, TXUpdateChoiceDismiss = 2 };
@protocol TXUpdateItem
@property(readonly, copy) NSString *versionString;
@end
static NSString *const TXDismissedUpdateVersionKey = @"TermixDismissedUpdateVersion";
@interface TXUpdateDelegate : NSObject
@property BOOL readyToTerminate;
@property(retain) NSUserDefaults *preferences;
@property(retain) id originalDelegate;
@end
static TXUpdateDelegate *updateDelegate;
static id<TXUpdaterController> updateController;
@implementation TXUpdateDelegate
- (NSUserDefaults *)updatePreferences { return self.preferences ?: NSUserDefaults.standardUserDefaults; }
- (void)updater:(id)updater userDidMakeChoice:(NSInteger)choice forUpdate:(id<TXUpdateItem>)item state:(id)state {
    if (choice != TXUpdateChoiceSkip && choice != TXUpdateChoiceDismiss) return;
    NSString *version = item.versionString;
    NSString *previous = [[self updatePreferences] stringForKey:TXDismissedUpdateVersionKey];
    if (version.length && (!previous || [version compare:previous options:NSNumericSearch] == NSOrderedDescending)) {
        [[self updatePreferences] setObject:version forKey:TXDismissedUpdateVersionKey];
    }
}
- (BOOL)updater:(id)updater shouldProceedWithUpdate:(id<TXUpdateItem>)item updateCheck:(NSInteger)check error:(NSError **)error {
    // 手動檢查仍可重新開啟已關閉的版本；只抑制自動通知。
    if (check == 0) return YES;
    NSString *dismissed = [[self updatePreferences] stringForKey:TXDismissedUpdateVersionKey];
    if (!dismissed || [item.versionString compare:dismissed options:NSNumericSearch] == NSOrderedDescending) return YES;
    if (error) *error = [NSError errorWithDomain:@"TermixUpdateNotification" code:1 userInfo:@{NSLocalizedDescriptionKey: @"此版本的更新通知已關閉。"}];
    return NO;
}
- (BOOL)respondsToSelector:(SEL)selector { return [super respondsToSelector:selector] || [self.originalDelegate respondsToSelector:selector]; }
- (id)forwardingTargetForSelector:(SEL)selector { return self.originalDelegate; }
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    // 更新前已經過 Go 的連線保護與清理，允許 Sparkle 正常結束程序。
    if (self.readyToTerminate) return NSTerminateNow;
    return [self.originalDelegate applicationShouldTerminate:sender];
}
- (void)updater:(id)updater didAbortWithError:(NSError *)error {
    self.readyToTerminate = NO;
    TermixUpdateAborted();
}
- (BOOL)updaterShouldRelaunchApplication:(id)updater {
    // Sparkle 在此回傳 NO 時會正常取消本次安裝，之後可從標準介面重試。
    self.readyToTerminate = TermixMayInstallUpdate() != 0;
    return self.readyToTerminate;
}
@end
int TermixConfirmUpdate(char *message) {
 NSAlert *alert = [NSAlert new];
 alert.messageText = @"更新 TermiX";
 alert.informativeText = [NSString stringWithUTF8String:message];
 [alert addButtonWithTitle:@"稍後"]; [alert addButtonWithTitle:@"中斷並更新"];
 BOOL approved = [alert runModal] == NSAlertSecondButtonReturn;
 [alert release]; return approved;
}
void TermixPendingUpdate(void) {
 NSAlert *alert = [NSAlert new];
 alert.messageText = @"暫時無法更新";
 alert.informativeText = @"有連線建立或指令操作尚未完成，請等候完成或取消操作後再試。";
 [alert addButtonWithTitle:@"好"]; [alert runModal]; [alert release];
}
// 集中啟動流程，供原生回歸測試驗證啟動時的檢查行為。
static void TXStartUpdateController(id<TXUpdaterController> controller) {
 [controller startUpdater];
 // 啟動後立即檢查，不等待上一次檢查起算的 1 小時；不覆寫使用者偏好。
 // 必須在下一個 run loop 前呼叫，避免干擾 Sparkle 後續排程。
 id<TXUpdater> updater = controller.updater;
 if (updater.automaticallyChecksForUpdates) [updater checkForUpdatesInBackground];
}
void TermixStartUpdater(void) {
 dispatch_async(dispatch_get_main_queue(), ^{
  if (updateController) return;
  NSBundle *app = NSBundle.mainBundle;
  if (![app objectForInfoDictionaryKey:@"SUPublicEDKey"]) return;
  NSString *path = [app.privateFrameworksPath stringByAppendingPathComponent:@"Sparkle.framework"];
  NSError *error = nil;
  if (![[NSBundle bundleWithPath:path] loadAndReturnError:&error]) { NSLog(@"TermiX 更新框架載入失敗：%@", error); return; }
  Class controllerClass = NSClassFromString(@"SPUStandardUpdaterController");
  if (!controllerClass) return;
  updateDelegate = [TXUpdateDelegate new];
  updateDelegate.originalDelegate = NSApp.delegate;
  NSApp.delegate = (id<NSApplicationDelegate>)updateDelegate;
  updateController = [(id<TXUpdaterController>)[controllerClass alloc] initWithStartingUpdater:NO updaterDelegate:updateDelegate userDriverDelegate:nil];
  TermixUpdaterReady();
  TXStartUpdateController(updateController);
 });
}
void TermixCheckUpdates(void) {
 dispatch_async(dispatch_get_main_queue(), ^{ [updateController checkForUpdates:nil]; });
}
void TermixUpdateSettings(void) {
 dispatch_async(dispatch_get_main_queue(), ^{
  if (!updateController) return;
  id<TXUpdater> updater = updateController.updater;
  NSAlert *alert = [NSAlert new];
  alert.messageText = @"更新設定";
  alert.informativeText = @"自動下載的更新會在結束 App 時安裝。有使用中的終端或轉發時，會先確認是否中斷。";
  NSView *view = [[[NSView alloc] initWithFrame:NSMakeRect(0,0,340,64)] autorelease];
  NSButton *checks = [NSButton checkboxWithTitle:@"自動檢查新版本" target:nil action:nil]; checks.frame = NSMakeRect(0,34,340,24); checks.state = updater.automaticallyChecksForUpdates;
  NSButton *downloads = [NSButton checkboxWithTitle:@"自動下載並在結束時安裝更新" target:nil action:nil]; downloads.frame = NSMakeRect(0,4,340,24); downloads.state = updater.automaticallyDownloadsUpdates;
  [view addSubview:checks]; [view addSubview:downloads]; alert.accessoryView = view;
  [alert addButtonWithTitle:@"儲存"]; [alert addButtonWithTitle:@"取消"];
  if ([alert runModal] == NSAlertFirstButtonReturn) { updater.automaticallyChecksForUpdates = checks.state == NSControlStateValueOn; updater.automaticallyDownloadsUpdates = downloads.state == NSControlStateValueOn; }
  [alert release];
 });
}

void TermixFinishQuit(void) {
 dispatch_async(dispatch_get_main_queue(), ^{
  updateDelegate.readyToTerminate = YES;
  [NSApp terminate:nil];
 });
}
