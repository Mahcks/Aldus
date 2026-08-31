local Event = require("ui/event")
local Screen = require("device").screen
local UIManager = require("ui/uimanager")
local md5 = require("ffi/sha2").md5
local userpatch = require("userpatch")

local mode = assert(os.getenv("ALDUS_KOREADER_MODE"), "ALDUS_KOREADER_MODE is required")
local output = assert(os.getenv("ALDUS_KOREADER_OUTPUT"), "ALDUS_KOREADER_OUTPUT is required")
local expected = assert(os.getenv("ALDUS_KOREADER_EXPECTED"), "ALDUS_KOREADER_EXPECTED is required")
local screenshot = assert(os.getenv("ALDUS_KOREADER_SCREENSHOT"), "ALDUS_KOREADER_SCREENSHOT is required")
local server = assert(os.getenv("ALDUS_KOREADER_SERVER"), "ALDUS_KOREADER_SERVER is required")
local username = assert(os.getenv("ALDUS_KOREADER_USERNAME"), "ALDUS_KOREADER_USERNAME is required")
local password = assert(os.getenv("ALDUS_KOREADER_PASSWORD"), "ALDUS_KOREADER_PASSWORD is required")
local finished = false
local pulled

local function finish(ok, message, pushed)
    if finished then return end
    finished = true
    local file = assert(io.open(output, "w"))
    file:write("status=", ok and "pass" or "fail", "\n")
    file:write("message=", message or "", "\n")
    file:write("pulled=", pulled or "", "\n")
    file:write("pushed=", pushed or "", "\n")
    file:close()
    UIManager:quit(ok and 0 or 1)
end

userpatch.registerPatchPluginFunc("kosync", function(plugin)
    local KOSyncClient = require("KOSyncClient")
    local original_get_progress = KOSyncClient.get_progress
    KOSyncClient.get_progress = function(self, user, key, document, callback)
        return original_get_progress(self, user, key, document, function(ok, body)
            if not ok or not body or not body.progress then
                finish(false, "KOReader could not pull progress")
                return
            end
            pulled = body.progress
            if pulled ~= expected then
                finish(false, "KOReader pulled a different XPointer")
                return
            end
            callback(ok, body)
        end)
    end

    local original_update_progress = KOSyncClient.update_progress
    KOSyncClient.update_progress = function(self, user, key, document, metadata, progress, percentage, device, device_id, callback)
        return original_update_progress(self, user, key, document, metadata, progress, percentage, device, device_id, function(ok, status, body)
            callback(ok, status, body)
            finish(ok, ok and "KOReader pulled, rendered, advanced, and pushed" or "KOReader could not push progress", progress)
        end)
    end

    local original_reader_ready = plugin.onReaderReady
    plugin.onReaderReady = function(self)
        self.settings.username = username
        self.settings.userkey = md5(password)
        self.settings.custom_server = server
        self.settings.kosync_hostname = "Aldus ecosystem acceptance"
        self.settings.checksum_method = 0
        self.settings.auto_sync = false
        original_reader_ready(self)

        UIManager:scheduleIn(1, function()
            self:getProgress(false, true)
        end)
    end

    local original_sync_to_progress = plugin.syncToProgress
    plugin.syncToProgress = function(self, progress)
        original_sync_to_progress(self, progress)
        UIManager:scheduleIn(1, function()
            local restored = self:getLastProgress()
            if restored ~= expected then
                finish(false, "KOReader did not render the pulled XPointer")
                return
            end
            Screen:shot(screenshot)
            if mode == "verify" then
                finish(true, "KOReader pulled and rendered the Aldus position")
                return
            end
            if mode ~= "advance" then
                finish(false, "unknown KOReader acceptance mode")
                return
            end
            self.ui:handleEvent(Event:new("GotoViewRel", 1))
            UIManager:scheduleIn(1, function()
                if self:getLastProgress() == restored then
                    finish(false, "KOReader did not advance a page")
                    return
                end
                Screen:shot(screenshot)
                self:updateProgress(false, true)
            end)
        end)
    end
end)

UIManager:scheduleIn(45, function()
    finish(false, "KOReader acceptance timed out")
end)
