#import <Cocoa/Cocoa.h>
#import "status_bar_darwin.h"

@interface TermixStatusBar : NSObject
@property(nonatomic, retain) NSStatusItem *item;
- (void)showWindow:(id)sender;
- (void)disconnect:(NSMenuItem *)sender;
@end

@implementation TermixStatusBar
- (void)disconnect:(NSMenuItem *)sender {
    NSDictionary *entry = sender.representedObject;
    sender.enabled = NO;
    TermixStatusBarDisconnect((char *)[entry[@"kind"] UTF8String], (char *)[entry[@"id"] UTF8String]);
}

- (void)showWindow:(id)sender {
    [NSApp unhide:nil];
    [NSApp activateIgnoringOtherApps:YES];
    for (NSWindow *window in NSApp.windows) {
        // Wails 的無邊框視窗只覆寫 canBecomeKeyWindow。
        if (window.canBecomeKeyWindow && ![window isKindOfClass:NSPanel.class]) {
            [window deminiaturize:nil];
            [window makeKeyAndOrderFront:nil];
            break;
        }
    }
}
- (void)dealloc {
    [_item release];
    [super dealloc];
}
@end

static TermixStatusBar *statusBar;

static void AddSection(NSMenu *menu, NSString *title, NSArray *rows, NSString *empty) {
    NSMenuItem *heading = [menu addItemWithTitle:title action:nil keyEquivalent:@""];
    heading.enabled = NO;
    for (NSString *row in rows.count ? rows : @[empty]) {
        NSMenuItem *item = [menu addItemWithTitle:row action:nil keyEquivalent:@""];
        item.enabled = NO;
        item.indentationLevel = 1;
        item.toolTip = row;
    }
    [menu addItem:NSMenuItem.separatorItem];
}

static void AddConnections(NSMenu *menu, NSString *title, NSArray *rows, NSString *empty, NSString *kind, NSString *actionTitle) {
    if (rows.count == 0) {
        AddSection(menu, title, @[], empty);
        return;
    }
    [menu addItemWithTitle:title action:nil keyEquivalent:@""].enabled = NO;
    for (NSDictionary *row in rows) {
        NSMenuItem *item = [menu addItemWithTitle:row[@"title"] action:nil keyEquivalent:@""];
        item.indentationLevel = 1;
        item.toolTip = row[@"title"];
        NSMenu *submenu = [[[NSMenu alloc] initWithTitle:row[@"title"]] autorelease];
        submenu.autoenablesItems = NO;
        NSMenuItem *disconnect = [submenu addItemWithTitle:actionTitle action:@selector(disconnect:) keyEquivalent:@""];
        disconnect.target = statusBar;
        disconnect.representedObject = @{@"kind": kind, @"id": row[@"id"]};
        disconnect.enabled = [row[@"id"] length] > 0;
        item.submenu = submenu;
    }
    [menu addItem:NSMenuItem.separatorItem];
}

void TermixUpdateStatusBar(const char *json) {
    // 必須先複製 Go 傳入的字串，主執行緒稍後執行時原始記憶體已釋放。
    NSString *payload = [[NSString alloc] initWithUTF8String:json];
    dispatch_async(dispatch_get_main_queue(), ^{
        NSDictionary *snapshot = [NSJSONSerialization JSONObjectWithData:[payload dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        if (![snapshot isKindOfClass:NSDictionary.class]) return;
        if (statusBar == nil) {
            statusBar = [[TermixStatusBar alloc] init];
            statusBar.item = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
            // 複製 App 圖示以保留 TermiX 原色，縮放時不影響 Dock 的共用圖像。
            NSImage *image = [[NSApp.applicationIconImage copy] autorelease];
            image.size = NSMakeSize(18, 18);
            image.template = NO;
            statusBar.item.button.image = image;
            statusBar.item.button.imagePosition = NSImageLeft;
        }
        NSArray *connections = snapshot[@"connections"];
        NSArray *forwards = snapshot[@"forwards"];
        NSString *summary = [NSString stringWithFormat:@"TermiX：%lu 個 SSH 連線，%lu 個 port-forward 執行中", (unsigned long)connections.count, (unsigned long)forwards.count];
        statusBar.item.button.title = [NSString stringWithFormat:@" %@SSH %lu · PF %lu", statusBar.item.button.image ? @"" : @"TX ", (unsigned long)connections.count, (unsigned long)forwards.count];
        statusBar.item.button.toolTip = summary;
        [statusBar.item.button setAccessibilityLabel:summary];

        NSMenu *menu = statusBar.item.menu;
        if (menu == nil) {
            menu = [[[NSMenu alloc] initWithTitle:@"TermiX"] autorelease];
            statusBar.item.menu = menu;
        }
        [menu removeAllItems];
        menu.autoenablesItems = NO;
        AddConnections(menu, @"SSH 連線", connections, @"目前沒有 SSH 連線", @"ssh", @"中斷連線");
        AddSection(menu, @"Kubernetes 目前叢集", snapshot[@"cluster"], @"尚未連線至叢集");
        AddConnections(menu, @"Port-forward", forwards, @"目前沒有執行中的轉發", @"forward", @"停止轉發");
        NSMenuItem *show = [menu addItemWithTitle:@"顯示 TermiX" action:@selector(showWindow:) keyEquivalent:@""];
        show.target = statusBar;
    });
    [payload release];
}

void TermixStatusBarShowError(const char *message) {
    NSString *detail = [[NSString alloc] initWithUTF8String:message];
    dispatch_async(dispatch_get_main_queue(), ^{
        if (statusBar == nil) return;
        NSAlert *alert = [[[NSAlert alloc] init] autorelease];
        alert.messageText = @"無法停止轉發";
        alert.informativeText = detail;
        [alert addButtonWithTitle:@"好"];
        [alert runModal];
    });
    [detail release];
}

void TermixRemoveStatusBar(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (statusBar == nil) return;
        [NSStatusBar.systemStatusBar removeStatusItem:statusBar.item];
        [statusBar release];
        statusBar = nil;
    });
}
