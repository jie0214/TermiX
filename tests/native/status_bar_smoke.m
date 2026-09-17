// macOS 原生選單測試；從專案根目錄執行：
// clang -fblocks -framework Cocoa tests/native/status_bar_smoke.m -o /tmp/termix-status-bar-test
// /tmp/termix-status-bar-test
#import <Cocoa/Cocoa.h>
#import "../../status_bar_darwin.m"

static NSString *lastKind;
static NSString *lastID;

void TermixStatusBarDisconnect(char *kind, char *identifier) {
    [lastKind release];
    [lastID release];
    lastKind = [[NSString alloc] initWithUTF8String:kind];
    lastID = [[NSString alloc] initWithUTF8String:identifier];
}

static void Drain(void) {
    [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.15]];
}

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        TermixUpdateStatusBar("{\"connections\":[],\"cluster\":[],\"forwards\":[]}");
        Drain();
        assert(statusBar != nil);
        assert([statusBar.item.button.title containsString:@"SSH 0 · PF 0"]);
        assert([statusBar.item.menu itemWithTitle:@"目前沒有 SSH 連線"] != nil);
        TermixUpdateStatusBar("{\"connections\":[{\"id\":\"ssh-a\",\"title\":\"同一主機\"},{\"id\":\"ssh-b\",\"title\":\"同一主機\"}],\"cluster\":[],\"forwards\":[{\"id\":\"forward-a\",\"title\":\"轉發\"}]}");
        Drain();
        NSMenu *menu = statusBar.item.menu;
        NSMenuItem *first = [[menu itemAtIndex:1].submenu itemAtIndex:0];
        NSMenuItem *second = [[menu itemAtIndex:2].submenu itemAtIndex:0];
        assert([first.title isEqualToString:@"中斷連線"]);
        [second.menu performActionForItemAtIndex:0];
        assert([lastKind isEqualToString:@"ssh"]);
        assert([lastID isEqualToString:@"ssh-b"]);
        assert(first.enabled && !second.enabled);
        NSMenuItem *forward = [[menu itemWithTitle:@"轉發"].submenu itemAtIndex:0];
        assert([forward.title isEqualToString:@"停止轉發"]);
        [forward.menu performActionForItemAtIndex:0];
        assert([lastKind isEqualToString:@"forward"]);
        assert([lastID isEqualToString:@"forward-a"]);
        TermixUpdateStatusBar("{\"connections\":[],\"cluster\":[],\"forwards\":[]}");
        Drain();
        assert([menu itemWithTitle:@"同一主機"] == nil);
        assert([menu itemWithTitle:@"目前沒有執行中的轉發"] != nil);
        TermixRemoveStatusBar();
        Drain();
        assert(statusBar == nil);
        [lastKind release];
        [lastID release];
        puts("原生選單、個別中斷連線、停止轉發與清理驗證通過");
    }
    return 0;
}
