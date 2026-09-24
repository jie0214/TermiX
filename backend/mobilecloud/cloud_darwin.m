#import <Foundation/Foundation.h>
#import <CloudKit/CloudKit.h>
#import <Security/Security.h>
#import <Security/SecTask.h>
#include <stdlib.h>

// 只回傳固定狀態；CloudKit 原始錯誤與設定內容不進入日誌。
int termixCloudConfigured(void) {
  @autoreleasepool {
    NSString *identifier = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"TermixCloudKitContainer"];
    SecTaskRef task = SecTaskCreateFromSelf(NULL);
    CFTypeRef entitlement = task ? SecTaskCopyValueForEntitlement(task, CFSTR("com.apple.developer.icloud-container-identifiers"), NULL) : NULL;
    BOOL configured = [identifier isKindOfClass:[NSString class]] && entitlement &&
      CFGetTypeID(entitlement) == CFArrayGetTypeID() && [(__bridge NSArray *)entitlement containsObject:identifier];
    CFTypeRef services = task ? SecTaskCopyValueForEntitlement(task, CFSTR("com.apple.developer.icloud-services"), NULL) : NULL;
    CFTypeRef environment = task ? SecTaskCopyValueForEntitlement(task, CFSTR("com.apple.developer.icloud-container-environment"), NULL) : NULL;
    configured = configured && services && CFGetTypeID(services) == CFArrayGetTypeID() &&
      [(__bridge NSArray *)services containsObject:@"CloudKit"] && environment &&
      CFGetTypeID(environment) == CFStringGetTypeID() &&
      [@[@"Development", @"Production"] containsObject:(__bridge NSString *)environment];
    if (services) CFRelease(services);
    if (environment) CFRelease(environment);
    if (entitlement) CFRelease(entitlement);
    if (task) CFRelease(task);
    return configured;
  }
}

char *termixCloudPublish(const char *payload) {
  @autoreleasepool {
    if (!termixCloudConfigured()) return strdup("not_configured");
    NSString *identifier = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"TermixCloudKitContainer"];
    NSString *text = [NSString stringWithUTF8String:payload];
    if (!text || [text lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 262144) return strdup("invalid");
    CKContainer *container = [CKContainer containerWithIdentifier:identifier];
    NSMutableDictionary *state = [NSMutableDictionary dictionaryWithObject:@"network" forKey:@"status"];
    NSCondition *done = [[[NSCondition alloc] init] autorelease];
    void (^finish)(NSString *) = ^(NSString *status) {
      [done lock];
      @synchronized(state) { state[@"status"] = status; state[@"finished"] = @YES; [state removeObjectForKey:@"operation"]; }
      [done signal]; [done unlock];
    };
    // 使用私有資料庫的單一快照；更新衝突由下一次週期重新讀取後再試。
    [container accountStatusWithCompletionHandler:^(CKAccountStatus status, NSError *error) {
      @synchronized(state) { if (state[@"expired"]) return; }
      if (error || status != CKAccountStatusAvailable) { finish(status == CKAccountStatusNoAccount ? @"no_account" : @"unavailable"); return; }
      CKDatabase *database = container.privateCloudDatabase;
      CKRecordID *recordID = [[[CKRecordID alloc] initWithRecordName:@"desktop-settings-v1"] autorelease];
      CKFetchRecordsOperation *fetch = [[[CKFetchRecordsOperation alloc] initWithRecordIDs:@[recordID]] autorelease];
      fetch.configuration.timeoutIntervalForRequest = 15;
      fetch.configuration.timeoutIntervalForResource = 20;
      fetch.perRecordCompletionBlock = ^(CKRecord *record, CKRecordID *unused, NSError *fetchError) {
        @synchronized(state) { if (state[@"expired"]) return; }
        if (fetchError && fetchError.code != CKErrorUnknownItem) { finish(@"network"); return; }
        CKRecord *snapshot = record ?: [[[CKRecord alloc] initWithRecordType:@"TermixMobileSettings" recordID:recordID] autorelease];
        if ([snapshot[@"payload"] isEqual:text]) { finish(@"ok"); return; }
        snapshot[@"payload"] = text;
        CKModifyRecordsOperation *save = [[[CKModifyRecordsOperation alloc] initWithRecordsToSave:@[snapshot] recordIDsToDelete:nil] autorelease];
        save.savePolicy = CKRecordSaveIfServerRecordUnchanged;
        save.configuration.timeoutIntervalForRequest = 15;
        save.configuration.timeoutIntervalForResource = 20;
        save.modifyRecordsCompletionBlock = ^(NSArray *saved, NSArray *deleted, NSError *saveError) { finish(saveError ? @"network" : @"ok"); };
        @synchronized(state) { if (state[@"expired"]) return; state[@"operation"] = save; [database addOperation:save]; }
      };
      @synchronized(state) { if (state[@"expired"]) return; state[@"operation"] = fetch; [database addOperation:fetch]; }
    }];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:45];
    [done lock];
    while (YES) {
      @synchronized(state) { if (state[@"finished"]) break; }
      if (![done waitUntilDate:deadline]) {
        @synchronized(state) { state[@"expired"] = @YES; [state[@"operation"] cancel]; [state removeObjectForKey:@"operation"]; }
        [done unlock]; return strdup("network");
      }
    }
    [done unlock];
    @synchronized(state) { return strdup([state[@"status"] UTF8String]); }
  }
}
