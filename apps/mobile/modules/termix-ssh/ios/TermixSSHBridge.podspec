Pod::Spec.new do |s|
  s.name = 'TermixSSHBridge'
  s.version = '0.1.0'
  s.summary = 'TermiX 手機 SSH 接入'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'TermiX'
  s.homepage = 'https://github.com/jie0214/TermiX-private'
  s.source = { :git => s.homepage }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.vendored_frameworks = 'TermixSSH.xcframework'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
