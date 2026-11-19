require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "DukaanNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/"
  s.license      = "MIT"
  s.authors      = "Dukaan"
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "", :tag => s.version.to_s }
  s.source_files = ["ios/**/*.{swift}", "cpp/**/*.{hpp,cpp}"]
  s.frameworks   = "CoreBluetooth"

  load "nitrogen/generated/ios/DukaanNative+autolinking.rb"
  add_nitrogen_files(s)

  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
  install_modules_dependencies(s)
end
