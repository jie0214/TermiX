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
  puts("PASS：原生更新取消、重試、結束路由與失敗恢復");
 }
 return 0;
}
