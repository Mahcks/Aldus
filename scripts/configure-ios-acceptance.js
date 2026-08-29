#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const xcode = require('../app/node_modules/xcode');

const [projectPath, server, username, password] = process.argv.slice(2);
if (!projectPath || !server || !username || !password) {
  console.error(
    'Usage: configure-ios-acceptance.js PROJECT_PBXPROJ SERVER USERNAME PASSWORD',
  );
  process.exit(2);
}

const project = xcode.project(projectPath);
project.parseSync();

const nativeTargets = project.pbxNativeTargetSection();
const targetEntry = (name) =>
  Object.entries(nativeTargets).find(
    ([key, value]) =>
      !key.endsWith('_comment') && value && value.name?.replaceAll('"', '') === name,
  );
const appEntry = targetEntry('Aldus');
if (!appEntry) throw new Error('Aldus application target was not found.');
if (targetEntry('AldusUITests')) throw new Error('AldusUITests target already exists.');

const [appID, appTarget] = appEntry;
const originalAddDependency = project.addTargetDependency;
project.addTargetDependency = () => undefined;
const tests = project.addTarget(
  'AldusUITests',
  'unit_test_bundle',
  'AldusUITests',
  'com.mahcks.aldus.acceptance.uitests',
);
project.addTargetDependency = originalAddDependency;
project.hash.project.objects.PBXContainerItemProxy ??= {};
project.hash.project.objects.PBXTargetDependency ??= {};
project.addTargetDependency(tests.uuid, [appID]);

tests.pbxNativeTarget.productType = '"com.apple.product-type.bundle.ui-testing"';
const productReference = tests.pbxNativeTarget.productReference;
const product = project.pbxFileReferenceSection()[productReference];
product.name = '"AldusUITests.xctest"';
product.path = '"AldusUITests.xctest"';
product.explicitFileType = '"wrapper.cfbundle"';
delete product.fileEncoding;
delete product.lastKnownFileType;
project.pbxFileReferenceSection()[`${productReference}_comment`] = 'AldusUITests.xctest';

project.addBuildPhase(
  ['../ios-acceptance/AldusUITests.swift'],
  'PBXSourcesBuildPhase',
  'Sources',
  tests.uuid,
);
project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', tests.uuid);
project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', tests.uuid);
for (const reference of Object.values(project.pbxFileReferenceSection())) {
  if (reference?.path?.includes('AldusUITests.swift')) delete reference.explicitFileType;
}
const projectAttributes = project.getFirstProject().firstProject.attributes;
projectAttributes.TargetAttributes ??= {};
projectAttributes.TargetAttributes[tests.uuid] = {
  CreatedOnToolsVersion: '16.0',
  TestTargetID: appID,
};

const configurations = project.pbxXCBuildConfigurationSection();
function configureTarget(target, configure) {
  const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
  for (const reference of list.buildConfigurations) {
    configure(configurations[reference.value].buildSettings);
  }
}

configureTarget(appTarget, (settings) => {
  settings.PRODUCT_BUNDLE_IDENTIFIER = '"com.mahcks.aldus.acceptance"';
});
configureTarget(tests.pbxNativeTarget, (settings) => {
  delete settings.INFOPLIST_FILE;
  settings.CODE_SIGN_STYLE = 'Automatic';
  settings.GENERATE_INFOPLIST_FILE = 'YES';
  settings.IPHONEOS_DEPLOYMENT_TARGET = '16.0';
  settings.PRODUCT_BUNDLE_IDENTIFIER = '"com.mahcks.aldus.acceptance.uitests"';
  settings.SWIFT_VERSION = '5.0';
  settings.TARGETED_DEVICE_FAMILY = '"1,2"';
  settings.TEST_TARGET_NAME = 'Aldus';
});

fs.writeFileSync(projectPath, project.writeSync());

const escapeXML = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const buildable = (id, name, productName) => `
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "${id}"
               BuildableName = "${productName}"
               BlueprintName = "${name}"
               ReferencedContainer = "container:Aldus.xcodeproj">
            </BuildableReference>`;
const appBuildable = buildable(appID, 'Aldus', 'Aldus.app');
const testBuildable = buildable(tests.uuid, 'AldusUITests', 'AldusUITests.xctest');
const scheme = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.7">
   <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="NO" buildForAnalyzing="YES">${appBuildable}
         </BuildActionEntry>
         <BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${testBuildable}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration="Release" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES">
      <Testables>
         <TestableReference skipped="NO" parallelizable="NO">${testBuildable}
         </TestableReference>
      </Testables>
      <EnvironmentVariables>
         <EnvironmentVariable key="ALDUS_ACCEPTANCE_SERVER" value="${escapeXML(server)}" isEnabled="YES"/>
         <EnvironmentVariable key="ALDUS_ACCEPTANCE_USERNAME" value="${escapeXML(username)}" isEnabled="YES"/>
         <EnvironmentVariable key="ALDUS_ACCEPTANCE_PASSWORD" value="${escapeXML(password)}" isEnabled="YES"/>
      </EnvironmentVariables>
      <MacroExpansion>${appBuildable}
      </MacroExpansion>
   </TestAction>
   <LaunchAction buildConfiguration="Release" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES">
      <BuildableProductRunnable runnableDebuggingMode="0">${appBuildable}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES">
      <BuildableProductRunnable runnableDebuggingMode="0">${appBuildable}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration="Release"/>
   <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
`;
const schemeDirectory = path.join(path.dirname(projectPath), 'xcshareddata', 'xcschemes');
fs.mkdirSync(schemeDirectory, { recursive: true });
fs.writeFileSync(path.join(schemeDirectory, 'AldusAcceptance.xcscheme'), scheme);
