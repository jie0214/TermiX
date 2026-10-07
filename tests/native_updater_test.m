// 原生橋接回歸測試：不啟動 GUI、不存取私鑰。
#import "../updater_darwin.m"
#include <assert.h>
static int approvals;
static int aborted;
static int notices;
static unsigned long long progressReceived, progressTotal;
static NSString *progressStatus;
void TermixDownloadProgress(char *version, char *status, unsigned long long received, unsigned long long total) {
 progressReceived = received; progressTotal = total; progressStatus = [NSString stringWithUTF8String:status];
}
void TermixUpdateFound(char *version) { assert(strcmp(version, "1.10.0") == 0); notices++; }
int TermixMayInstallUpdate(void) { return approvals; }
void TermixUpdaterReady(void) {}
void TermixUpdateAborted(void) { aborted++; }
@interface TestAppDelegate : NSObject
@end
@implementation TestAppDelegate
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender { return NSTerminateCancel; }
@end
@interface TestUpdater : NSObject
@property BOOL automaticallyChecksForUpdates;
@property BOOL automaticallyDownloadsUpdates;
@property int backgroundChecks;
@property BOOL canCheckForUpdates;
- (void)checkForUpdatesInBackground;
@end
@implementation TestUpdater
- (void)checkForUpdatesInBackground { self.backgroundChecks++; }
@end
@interface TestUpdaterController : NSObject <TXUpdaterController>
@property(retain) TestUpdater *testUpdater;
@property BOOL started;
@property int manualChecks;
@end
@implementation TestUpdaterController
- (id)initWithStartingUpdater:(BOOL)start updaterDelegate:(id)delegate userDriverDelegate:(id)driver { return [super init]; }
- (BOOL)startUpdater { self.started = YES; return YES; }
- (void)checkForUpdates:(id)sender { self.manualChecks++; }
- (id<TXUpdater>)updater { assert(self.started); return (id<TXUpdater>)self.testUpdater; }
@end
@interface TestUpdateItem : NSObject <TXUpdateItem>
@property(copy) NSString *versionString;
@end
@implementation TestUpdateItem
@end
@interface TestStandardDriver : NSObject
@property unsigned long long bytes;
@property unsigned long long total;
@property BOOL ready;
@end
@implementation TestStandardDriver
- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)length { self.total = length; }
- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length { self.bytes += length; }
- (void)showReadyToInstallAndRelaunch:(void (^)(NSInteger))reply { self.ready = YES; }
- (void)showUpdateInFocus { self.ready = NO; }
@end
int main(void) {
 @autoreleasepool {
  updateDelegate = [TXUpdateDelegate new];
  NSString *suite = [@"termix-update-test-" stringByAppendingString:NSUUID.UUID.UUIDString];
  NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:suite];
  updateDelegate.preferences = preferences;
  updateDelegate.originalDelegate = [[[TestAppDelegate alloc] init] autorelease];
  assert([updateDelegate applicationShouldTerminate:nil] == NSTerminateCancel);
  assert(![updateDelegate updaterShouldRelaunchApplication:nil]);
  assert(!updateDelegate.readyToTerminate);
  approvals=1;
  assert([updateDelegate updaterShouldRelaunchApplication:nil]);
  assert([updateDelegate applicationShouldTerminate:nil] == NSTerminateNow);
  [updateDelegate updater:nil didAbortWithError:nil];
  assert(aborted==1 && !updateDelegate.readyToTerminate);
  approvals=0;
  assert(![updateDelegate updaterShouldRelaunchApplication:nil]);
  TestUpdaterController *controller = [TestUpdaterController new];
  controller.testUpdater = [TestUpdater new];
  controller.testUpdater.automaticallyChecksForUpdates = YES;
  TXStartUpdateController(controller);
  assert(controller.started && controller.manualChecks == 0);
  assert(controller.testUpdater.backgroundChecks == 1 && "啟用自動更新時，啟動後應立即背景檢查一次");
  controller.testUpdater.automaticallyChecksForUpdates = NO;
  TXStartUpdateController(controller);
  assert(controller.testUpdater.backgroundChecks == 1 && "停用自動更新時不得觸發背景檢查");
  controller.testUpdater.automaticallyDownloadsUpdates = YES;
  TestUpdateItem *found = [TestUpdateItem new]; found.versionString = @"1.10.0";
  assert([updateDelegate respondsToSelector:@selector(updater:didFindValidUpdate:)] && "自動下載發現新版時必須提供通知");
  [updateDelegate performSelector:@selector(updater:didFindValidUpdate:) withObject:controller.testUpdater withObject:found];
  assert(notices == 1);
  controller.testUpdater.automaticallyDownloadsUpdates = NO;
  [updateDelegate performSelector:@selector(updater:didFindValidUpdate:) withObject:controller.testUpdater withObject:found];
  assert(notices == 1 && "一般更新使用 Sparkle 原生視窗，不重複提示");
  __block int busy = 0;
  TXCheckUpdates(controller, ^{ busy++; });
  assert(busy == 1 && controller.manualChecks == 0 && "更新中顯示狀態，不重複啟動檢查");
  controller.testUpdater.canCheckForUpdates = YES;
  TXCheckUpdates(controller, ^{ busy++; });
  assert(busy == 1 && controller.manualChecks == 1 && "可檢查時應開啟 Sparkle 視窗");
  TestUpdateItem *item = [TestUpdateItem new]; item.versionString = @"1.9.1";
  NSError *error = nil;
  assert([updateDelegate updater:nil shouldProceedWithUpdate:item updateCheck:1 error:&error]);
  [updateDelegate updater:nil userDidMakeChoice:TXUpdateChoiceInstall forUpdate:item state:nil];
  assert([updateDelegate updater:nil shouldProceedWithUpdate:item updateCheck:1 error:&error]);
  [updateDelegate updater:nil userDidMakeChoice:TXUpdateChoiceDismiss forUpdate:item state:nil];
  TXUpdateDelegate *restarted = [TXUpdateDelegate new]; restarted.preferences = [[NSUserDefaults alloc] initWithSuiteName:suite];
  assert(![restarted updater:nil shouldProceedWithUpdate:item updateCheck:1 error:&error] && error);
  assert([restarted updater:nil shouldProceedWithUpdate:item updateCheck:0 error:&error]);
  item.versionString = @"1.10.0";
  assert([restarted updater:nil shouldProceedWithUpdate:item updateCheck:1 error:&error]);
  [restarted updater:nil userDidMakeChoice:TXUpdateChoiceSkip forUpdate:item state:nil];
  assert(![restarted updater:nil shouldProceedWithUpdate:item updateCheck:1 error:&error]);
  item.versionString = @"1.9.9";
  assert(![restarted updater:nil shouldProceedWithUpdate:item updateCheck:1 error:&error]);
  controller.testUpdater.automaticallyDownloadsUpdates = YES;
  [restarted updater:(id<TXUpdater>)controller.testUpdater didFindValidUpdate:item];
  assert(notices == 1 && "已關閉的版本不再送出自動下載通知");
  TXProgressDriver *driver = [TXProgressDriver new];
  TestStandardDriver *standard = [TestStandardDriver new];
  driver.standard = (id<TXStandardDriver>)standard;
  item.versionString = @"1.10.0";
  [updateDelegate updater:nil willDownloadUpdate:item withRequest:nil];
  assert(progressTotal == 0 && progressReceived == 0 && [progressStatus isEqualToString:@"downloading"]);
  [driver showDownloadDidReceiveExpectedContentLength:100];
  downloadLastReport = 0;
  [driver showDownloadDidReceiveDataOfLength:68];
  assert(progressReceived == 68 && progressTotal == 100 && standard.bytes == 68 && standard.total == 100);
  [updateDelegate updater:nil didDownloadUpdate:item];
  assert([progressStatus isEqualToString:@"verifying"]);
  [driver showReadyToInstallAndRelaunch:nil];
  assert(standard.ready && [progressStatus isEqualToString:@"ready"]);
  assert([driver respondsToSelector:@selector(showUpdateInFocus)]);
  [driver performSelector:@selector(showUpdateInFocus)];
  assert(!standard.ready && "原生使用者操作必須繼續轉送");
  [updateDelegate updater:nil willDownloadUpdate:item withRequest:nil];
  assert(progressReceived == 0 && progressTotal == 0 && "重試須歸零，不沿用舊進度");
  [updateDelegate userDidCancelDownload:nil];
  assert([progressStatus isEqualToString:@"cancelled"]);
  [updateDelegate updater:nil didAbortWithError:nil];
  assert([progressStatus isEqualToString:@"cancelled"]);
  [updateDelegate updater:nil willDownloadUpdate:item withRequest:nil];
  [updateDelegate updater:nil failedToDownloadUpdate:item error:nil];
  assert([progressStatus isEqualToString:@"error"]);
  assert(![updateDelegate updater:nil willInstallUpdateOnQuit:item immediateInstallationBlock:nil]);
  assert([progressStatus isEqualToString:@"ready"] && "保留 Sparkle 結束時安裝流程");
  [driver release]; [standard release];
  [preferences removePersistentDomainForName:suite];
  puts("PASS：背景下載通知、忙碌狀態路由、啟動檢查、停用偏好、更新取消與結束保護");
 }
 return 0;
}
