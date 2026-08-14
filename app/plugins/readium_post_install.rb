# Temporary RC 17 compatibility hook. Remove after upgrading react-native-readium.
def readium_post_install(installer)
  modulemap = <<~MODULEMAP
    module Minizip [extern_c] [system] {
      header "Minizip-umbrella.h"
      export *
    }
  MODULEMAP
  framework_modulemap = <<~MODULEMAP
    framework module Minizip [extern_c] [system] {
      umbrella header "Minizip-umbrella.h"
      export *
    }
  MODULEMAP

  framework_path = File.join(installer.sandbox.root, 'Target Support Files', 'Minizip', 'Minizip.modulemap')
  headers_path = File.join(installer.sandbox.root, 'Headers', 'Public', 'Minizip', 'Minizip.modulemap')
  File.write(framework_path, framework_modulemap) if File.exist?(framework_path)
  File.write(headers_path, modulemap) if File.exist?(headers_path)

  installer.pods_project.targets.each do |target|
    next unless target.name == 'Minizip'

    target.build_configurations.each do |config|
      ['OTHER_CFLAGS', 'OTHER_CPLUSPLUSFLAGS'].each do |setting|
        flags = Array(config.build_settings[setting])
        flags = ['$(inherited)'] if flags.empty?
        unless flags.any? { |flag| flag.include?('-Wno-module-import-in-extern-c') }
          config.build_settings[setting] = flags + ['-Wno-module-import-in-extern-c']
        end
      end
    end
  end
end
