#import <Cocoa/Cocoa.h>

#import "window_appearance_darwin.h"

static void ApplyCornerRadius(NSWindow *window, CGFloat radius) {
    NSView *contentView = window.contentView;
    if (contentView == nil) {
        return;
    }

    // Frameless 視窗沒有 NSWindowStyleMaskTitled；必須直接裁切 content view，
    // 才能同時裁切 Wails 注入的 NSVisualEffectView 與 WKWebView。
    [window setOpaque:NO];
    [window setBackgroundColor:NSColor.clearColor];
    [contentView setWantsLayer:YES];
    contentView.layer.cornerRadius = radius;
    contentView.layer.masksToBounds = YES;
}

void TermixApplyNativeWindowCornerRadius(double radius) {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSWindow *window = NSApp.mainWindow;
        if (window == nil) {
            window = NSApp.windows.firstObject;
        }
        if (window != nil) {
            ApplyCornerRadius(window, radius);
        }
    });
}
