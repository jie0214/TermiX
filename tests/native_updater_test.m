// 原生橋接回歸測試：不啟動 GUI、不存取私鑰。
#import "../updater_darwin.m"
#include <assert.h>
static int approvals;
static int aborted;
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
- (void)checkForUpdatesInBackground;
@end
@implementation TestUpdater
- (void)checkForUpdatesInBackground { self.backgroundChecks++; }
@end
@interface TestUpdaterController : NSObject <TXUpdaterController>
@property(retain) TestUpdater *testUpdater;
@property BOOL started;
@end
@implementation TestUpdaterController
- (id)initWithStartingUpdater:(BOOL)start updaterDelegate:(id)delegate userDriverDelegate:(id)driver { return [super init]; }
- (void)startUpdater { self.started = YES; }
- (void)checkForUpdates:(id)sender { assert(!"啟動時不應顯示手動檢查視窗"); }
- (id<TXUpdater>)updater { assert(self.started); return (id<TXUpdater>)self.testUpdater; }
@end
@interface TestUpdateItem : NSObject <TXUpdateItem>
@property(copy) NSString *versionString;
@end
@implementation TestUpdateItem
@end
int main(void) {
 @autoreleasepool {
  updateDelegate = [TXUpdateDelegate new];
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
  assert(controller.started);
  assert(controller.testUpdater.backgroundChecks == 1 && "啟用自動更新時，啟動後應立即背景檢查一次");
  controller.testUpdater.automaticallyChecksForUpdates = NO;
  TXStartUpdateController(controller);
  assert(controller.testUpdater.backgroundChecks == 1 && "停用自動更新時不得觸發背景檢查");
  NSString *suite = [@"termix-update-test-" stringByAppendingString:NSUUID.UUID.UUIDString];
  NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:suite];
  updateDelegate.preferences = preferences;
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
  [preferences removePersistentDomainForName:suite];
  puts("PASS：原生啟動背景檢查、停用偏好、更新取消、重試、結束路由與失敗恢復");
 }
 return 0;
}
