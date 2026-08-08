/*
 * LLM Tools — SillyTavern Extension
 * Quick Erase, Rethink, Widget, Immersive Time Skip, Action & Speak, VN Mode
 */

var MODULE = "llm-tools";

var scriptModule = null;
var chatModule = null;
var extsModule = null;

var settings = {};

var RETHINK_MODES = {
    "short": { label: "Short", prompt: "[System note: Write a very short, concise response. 1-2 sentences maximum.]" },
    "detailed": { label: "Detailed", prompt: "[System note: Provide a highly detailed, descriptive, and long response.]" },
    "interactive": { label: "Interactive", prompt: "[System note: Be highly interactive. End your response immediately the moment it is the user's turn to react, answer, or make a decision. NEVER take actions for the user or advance the scene without their input.]" },
    "narrative": { label: "Narrative Only", prompt: "[System note: Write ONLY narrative and actions. Do NOT write any spoken dialogue.]" },
    "dialogue": { label: "Dialogue Only", prompt: "[System note: Write ONLY spoken dialogue. No actions or descriptions.]" },
    "angry": { label: "Angry Tone", prompt: "[System note: Rewrite the response with a visibly angry, irritated, and harsh tone.]" },
    "romantic": { label: "Romantic Tone", prompt: "[System note: Rewrite the response with a romantic, gentle, and affectionate tone.]" },
    "random": { label: "Random Length", prompt: "[System note: Choose the response length entirely at random. Break any previous length patterns.]" },
    "smart": { label: "Smart Length", prompt: "[System note: Dynamically adjust the length and detail of your response based on the narrative context. Fast-paced conversation = short. Important actions/emotions = highly detailed.]" },
    "adaptive": { label: "Adaptive Length", prompt: "[System note: Calibrate your response length and detail level to precisely mirror the user's last message. Short user message = short response. Long and detailed user message = long and detailed response. Match their depth, energy, and pace exactly.]" },
    "ai_choose": { label: "✨ AI Choose", prompt: "[System note: Before writing your response, silently analyse the current moment and choose the single most fitting style from the following options — Short, Detailed, Interactive, Narrative Only, Dialogue Only, Angry Tone, Romantic Tone, Random Length, Smart Length, Adaptive Length. Apply the chosen style naturally. Do NOT mention which style you selected, do NOT add any meta-commentary. Just write the response in that style.]" }
};

var WIDGET_ITEMS =[
    { id: 'erase',    icon: 'fa-bolt',              label: 'Erase',    color: '#e74c3c', title: 'Quick Erase Last Message' },
    { id: 'continue', icon: 'fa-arrow-right',        label: 'Continue', color: '#2ecc71', title: 'Continue Generation' },
    { id: 'rethink',  icon: 'fa-brain',              label: 'Rethink',  color: '#d69ae5', title: 'Rethink Last Message' },
    { id: 'action',   icon: 'fa-person-running',     label: 'Action',   color: '#a78bfa', title: 'Perform an Action' },
    { id: 'speak',    icon: 'fa-comment',            label: 'Speak',    color: '#5bc0de', title: 'Say Something' },
    { id: 'think',    icon: 'fa-lightbulb',          label: 'Think',    color: '#f1c40f', title: 'Think Something' },
    { id: 'time',     icon: 'fa-clock-rotate-left',  label: 'Skip',     color: '#7fc8d9', title: 'Time Skip' },
    { id: 'vn',       icon: 'fa-book-open',          label: 'VN',       color: '#f5a623', title: 'Visual Novel Mode' },
];

// Quick-fill shortcuts for the "By Action" time skip mode.
// The user can add/remove their own in the extension settings.
var DEFAULT_SKIP_CHIPS = [
    'Have breakfast',
    'Take a shower',
    'Go to sleep',
    'Travel to the city',
    'Train for a while',
];

var isManualRethink = false;
var manualRethinkMesId = -1;
var manualUserIdx = -1;
var manualOriginalText = "";

var autoUserIdx = -1;
var autoOriginalText = "";

var greetingPickerBypassFlag  = false;
var greetingPatchedCharId     = null;
var greetingPatchedOriginalMes = null;
var greetingRestoreTimer      = null;

var vnCurrentChunkIndex = 0;
// Translation cache: mesId -> { lang, text }
var llmtTranslationCache = {};
// Track last emitted chunk to avoid spamming chunk-advance events
var vnLastEmittedKey = '';
// Track totalChunks across renders so we can detect when a new paragraph
// boundary appears mid-stream and force-emit the now-stable previous chunk.
var vnLastSeenTotalChunks = 0;
// "Sticky" record of how many paragraphs the user actually read on the most
// recent AI message. We need this separately from vnCurrentChunkIndex because
// vnCurrentChunkIndex can be reset by DOM observers, mid-stream rerenders, or
// the translate extension swapping .mes_text contents — all of which can fire
// between the moment the user clicks Send and the moment our MESSAGE_SENT
// handler runs. Updated every time the Continue button is clicked AND every
// time updateVnView shows a non-zero chunk, so it tracks the high-water mark.
//   { mesKey: string|null, paragraphsRead: number }
// mesKey is "<mesid>|<first-80-chars-of-mes-text>" so it survives translate
// extensions toggling display_text but invalidates if the message itself
// changes (e.g. swipe, edit).
var vnLastReadHighWater = { mesKey: null, paragraphsRead: 0 };

jQuery(function () { initAll(); });

async function initAll() {
    try {
        await loadModules();
        loadSettings();
        buildSettingsUI();
        buildWidget();
        buildRadialWidgets();
        buildTimeSkipUI();
        buildActionUI();
        buildSpeakUI();
        buildThinkUI();
        buildGreetingPickerUI();
        buildVnUI();
        buildDynCaptionUI();
        setupGreetingInterceptors();
        bindEvents();
        setupDynCaptionHook();
        // Public API for other extensions (e.g. AutoVoice) that want to be
        // VN-aware. All members are read-only helpers — no mutators exposed.
        window.LLMTools = window.LLMTools || {};
        window.LLMTools.isVnMode = function() { return !!settings.visualNovelMode; };
        window.LLMTools.getCurrentVnChunkIndex = function() { return vnCurrentChunkIndex; };
        window.LLMTools.getCurrentVnChunkText = getCurrentVnChunkText;
        window.LLMTools.getVnTextChunks = getVnTextChunks;

        /* ── v1.7: Greeting Picker bridge (Character Library, Hook Forge, …) ──
           Other extensions own the browsing UI; the picker and the safe
           first_mes swap stay here, in one place. */
        window.LLMTools.hasGreetingPicker = function () { return true; };
        window.LLMTools.getGreetings = apiGetGreetings;
        window.LLMTools.openGreetingPicker = apiOpenGreetingPicker;
        window.LLMTools.startChatWithGreeting = apiStartChatWithGreeting;

        console.log("[LLM Tools] Loaded: Quick Erase, Rethink, Time Skip, Action, Speak & Advanced VN Mode!");
    } catch (e) {
        console.error("[LLM Tools] Init error:", e);
    }
}

async function loadModules() {
    try { scriptModule = await import("../../../../script.js"); } catch (e) { }
    try { chatModule = await import("../../../chat.js"); } catch (e) { }
    try { extsModule = await import("../../../extensions.js"); } catch (e) { }
}

async function safeSaveChat() {
    if (!scriptModule) return;
    if (typeof scriptModule.saveChatConditional === "function") {
        await scriptModule.saveChatConditional();
        return;
    }
    if (scriptModule.selected_group) {
        if (typeof scriptModule.saveGroupChat === "function") await scriptModule.saveGroupChat();
    } else {
        if (typeof scriptModule.saveChat === "function") await scriptModule.saveChat();
    }
}

function getChatCharacters() {
    var selectedGroup = (scriptModule && scriptModule.selected_group) || window.selected_group || null;
    var groups        = (scriptModule && scriptModule.groups)         || window.groups         ||[];
    var characters    = (scriptModule && scriptModule.characters)     || window.characters     ||[];
    var currentCharId = (scriptModule && (scriptModule.this_chid !== undefined ? scriptModule.this_chid : scriptModule.characterId));
    if (currentCharId === undefined) currentCharId = window.this_chid;

    function getDomCharNames() {
        var seen = {};
        var result =[];
        $('#chat .mes').each(function () {
            if ($(this).attr('is_user') === 'true') return;
            var name = $(this).find('.name_text').text().trim();
            if (name && !seen[name]) { seen[name] = true; result.push(name); }
        });
        return result;
    }

    if (selectedGroup) {
        var grp = groups.find(function (g) { return String(g.id) === String(selectedGroup); });
        if (grp && grp.members && grp.members.length) {
            var names =[];
            if (characters.length) {
                names = grp.members.map(function (memberId) {
                    var mStr  = String(memberId);
                    var mBase = mStr.replace(/\.[^.]+$/, '').toLowerCase();
                    var ch = characters.find(function (c) {
                        if (!c) return false;
                        if (c.avatar === mStr || c.name === mStr) return true;
                        var aBase = c.avatar ? c.avatar.replace(/\.[^.]+$/, '').toLowerCase() : '';
                        if (aBase && aBase === mBase) return true;
                        if (c.name && c.name.toLowerCase() === mBase) return true;
                        return false;
                    });
                    if (ch) return ch.name;
                    return mStr.replace(/\.[^.]+$/, '') || null;
                }).filter(Boolean);
            } else {
                names = grp.members.map(function (m) { return String(m).replace(/\.[^.]+$/, '') || null; }).filter(Boolean);
            }
            if (names.length) return names;
        }
        var domNames = getDomCharNames();
        if (domNames.length) return domNames;
    }

    if (characters.length && currentCharId !== undefined && currentCharId !== null) {
        var ch = characters[currentCharId];
        if (ch && ch.name) return [ch.name];
    }
    return getDomCharNames();
}

function triggerContinue() {
    if (!scriptModule || !scriptModule.chat || scriptModule.is_generating) return;
    var $nativeContinue = $('#chat_continue');
    if ($nativeContinue.length) {
        $nativeContinue.click();
    } else {
        var $ta = $('#send_textarea');
        var oldText = $ta.val();
        $ta.val('/continue').trigger('input');
        $('#send_but').click();
        setTimeout(function () { if ($ta.val() === '') $ta.val(oldText).trigger('input'); }, 200);
    }
}

function sendToChat(text) {
    var $ta = $('#send_textarea');
    $ta.val(text).trigger('input');
    setTimeout(function () { $('#send_but').click(); }, 80);
}

function loadSettings() {
    var extSettings = null;
    if (typeof extension_settings !== 'undefined') {
        extSettings = extension_settings;
    } else if (extsModule && extsModule.extension_settings) {
        extSettings = extsModule.extension_settings;
    }

    if (extSettings) {
        if (!extSettings[MODULE]) extSettings[MODULE] = {};
        settings = extSettings[MODULE];

        if (settings.enabled === undefined)        settings.enabled        = true;
        if (settings.autoRethink === undefined)    settings.autoRethink    = false;
        if (settings.rethinkMode === undefined)    settings.rethinkMode    = "short";
        if (settings.widgetEnabled === undefined)  settings.widgetEnabled  = true;
        if (settings.widgetPosition === undefined) settings.widgetPosition = "bottom-center";
        if (settings.widgetX === undefined)        settings.widgetX        = "100px";
        if (settings.widgetY === undefined)        settings.widgetY        = "100px";
        if (settings.visualNovelMode === undefined) settings.visualNovelMode = false;
        if (settings.greetingPickerEnabled === undefined) settings.greetingPickerEnabled = true;
        if (settings.widgetStyle === undefined) settings.widgetStyle = "classic";
        if (settings.translateEnabled === undefined) settings.translateEnabled = false;
        if (settings.translateLang === undefined)    settings.translateLang    = "Russian";
        if (settings.dynCaptionEnabled === undefined) settings.dynCaptionEnabled = false;
        if (settings.dynCaptionConfirm === undefined) settings.dynCaptionConfirm = true;
        if (settings.timeSkipMode === undefined)      settings.timeSkipMode      = "clock";
        if (!Array.isArray(settings.timeSkipChips))   settings.timeSkipChips     = DEFAULT_SKIP_CHIPS.slice();
    }
}

function saveSettings() {
    if (scriptModule && typeof scriptModule.saveSettingsDebounced === 'function') {
        scriptModule.saveSettingsDebounced();
    } else if (typeof saveSettingsDebounced === 'function') {
        saveSettingsDebounced();
    }
}

function buildSettingsUI() {
    var $container = $("#extensions_settings2").length ? $("#extensions_settings2") : $("#extensions_settings");
    if (!$container.length) return;

    var modeOptions = "";
    for (var key in RETHINK_MODES) {
        var sel = (key === settings.rethinkMode) ? 'selected' : '';
        modeOptions += `<option value="${key}" ${sel}>${RETHINK_MODES[key].label}</option>`;
    }

    var h = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-bolt"></i> LLM Tools</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="da-srow llmtools-settings-row">
                <label class="checkbox_label">
                    <input type="checkbox" id="llmt-s-enabled"><span><b>Enable LLM Tools</b></span>
                </label>
            </div>
            <hr class="sysHR" />
            <div class="da-srow llmtools-settings-row">
                <label class="checkbox_label">
                    <input type="checkbox" id="llmt-s-widget"><span><b>Show Floating Widget</b></span>
                </label>
            </div>
            <div class="da-srow llmtools-settings-row">
                <label><small>Widget Position:</small></label>
                <select id="llmt-s-pos" class="text_pole">
                    <option value="bottom-center">Bottom Center</option>
                    <option value="top-center">Top Center</option>
                    <option value="top-right">Top Right</option>
                    <option value="bottom-right">Bottom Right</option>
                    <option value="custom">Custom (Draggable)</option>
                </select>
            </div>
            <div class="da-srow llmtools-settings-row">
                <label><small>Widget Style:</small></label>
                <select id="llmt-s-style" class="text_pole">
                    <option value="classic">Classic Bar</option>
                    <option value="radial-bloom">Radial Bloom</option>
                    <option value="arc-fan">Arc Fan</option>
                    <option value="minimal-orb">Minimal Orb</option>
                </select>
            </div>
            <hr class="sysHR" />
            <div class="da-srow llmtools-settings-row">
                <label class="checkbox_label">
                    <input type="checkbox" id="llmt-s-auto"><span><b>Auto Rethink</b></span>
                </label>
            </div>
            <div class="da-srow llmtools-settings-row">
                <label><small>Rethink Mode:</small></label>
                <select id="llmt-s-mode" class="text_pole">
                    ${modeOptions}
                </select>
            </div>
            <hr class="sysHR" />
            <div class="da-srow llmtools-settings-row">
                <label class="checkbox_label">
                    <input type="checkbox" id="llmt-s-vn"><span><b>📖 Visual Novel Mode</b></span>
                </label>
                <small style="color:#888;margin-top:4px;display:block">Hides all messages except the last one — like a visual novel or video game.</small>
            </div>
            <hr class="sysHR" />
            <div class="da-srow llmtools-settings-row">
                <label class="checkbox_label">
                    <input type="checkbox" id="llmt-s-greet"><span><b>🎲 Alternate Greeting Picker</b></span>
                </label>
                <small style="color:#888;margin-top:4px;display:block">Show a greeting selector before a new chat opens, if the character has alternate greetings.</small>
            </div>
            <hr class="sysHR" />
            <div class="da-srow llmtools-settings-row">
                <label class="checkbox_label">
                    <input type="checkbox" id="llmt-s-trans-enabled"><span><b>🌐 LLM Translation</b></span>
                </label>
                <small style="color:#888;margin-top:4px;display:block">Adds a translate button (🌐) to each message. Uses the current LLM. The original text is always sent to the AI — only the display changes.</small>
            </div>
            <div class="da-srow llmtools-settings-row">
                <label><small>Target Language:</small></label>
                <input type="text" id="llmt-s-trans-lang" class="text_pole" style="width:100%;margin-top:4px" placeholder="e.g. Russian, English, German, Japanese…">
            </div>
            <hr class="sysHR" />
            <div class="da-srow llmtools-settings-row">
                <label><b>⏳ Time Skip — Action Shortcuts</b></label>
                <small style="color:#888;margin-top:4px;display:block">Quick-fill buttons shown in the <b>By Action</b> tab of the Time Skip dialog.</small>
                <div id="llmt-s-chips-list" class="llmt-s-chips-list"></div>
                <div class="llmt-s-chips-add">
                    <input type="text" id="llmt-s-chip-new" class="text_pole" placeholder="New shortcut, e.g. Cook dinner">
                    <div class="menu_button" id="llmt-s-chip-add" title="Add shortcut"><i class="fa-solid fa-plus"></i></div>
                    <div class="menu_button" id="llmt-s-chip-reset" title="Restore default shortcuts"><i class="fa-solid fa-rotate-left"></i></div>
                </div>
            </div>
            <hr class="sysHR" />
            <div class="da-srow llmtools-settings-row">
                <label class="checkbox_label">
                    <input type="checkbox" id="llmt-s-dyncap"><span><b>🖼️ Dynamic Caption Prompt</b></span>
                </label>
                <small style="color:#888;margin-top:4px;display:block">When you attach an image, auto-generates a context-aware captioning prompt based on what <b>{{char}}</b> would expect to see — using the current character card and recent chat.</small>
            </div>
            <div class="da-srow llmtools-settings-row" id="llmt-s-dyncap-confirm-row" style="padding-left:10px">
                <label class="checkbox_label">
                    <input type="checkbox" id="llmt-s-dyncap-confirm"><span><small>Ask before updating prompt</small></span>
                </label>
            </div>
        </div>
    </div>`;
    $container.append(h);

    $("#llmt-s-enabled").prop("checked", settings.enabled).on("change", function () {
        settings.enabled = this.checked; saveSettings(); applyEnabledState();
    });
    $("#llmt-s-widget").prop("checked", settings.widgetEnabled).on("change", function () {
        settings.widgetEnabled = this.checked; saveSettings(); updateWidgetVisibility();
    });
    $("#llmt-s-pos").val(settings.widgetPosition).on("change", function () {
        settings.widgetPosition = this.value; saveSettings(); applyWidgetPosition();
    });
    $("#llmt-s-style").val(settings.widgetStyle).on("change", function () {
        settings.widgetStyle = this.value; saveSettings(); updateWidgetVisibility(); applyWidgetPosition();
    });
    $("#llmt-s-auto").prop("checked", settings.autoRethink).on("change", function () {
        settings.autoRethink = this.checked;
        saveSettings();
        $("#llmt-w-auto").prop("checked", this.checked);
        if (!this.checked) cleanupAutoRethink();
    });
    $("#llmt-s-mode").val(settings.rethinkMode).on("change", function () {
        settings.rethinkMode = this.value;
        saveSettings();
        $("#llmt-w-mode").val(this.value);
    });
    $("#llmt-s-vn").prop("checked", settings.visualNovelMode).on("change", function () {
        settings.visualNovelMode = this.checked;
        saveSettings();
        applyVisualNovelMode();
        $("#llmt-w-vn").toggleClass("active", settings.visualNovelMode);
    });
    $("#llmt-s-greet").prop("checked", settings.greetingPickerEnabled).on("change", function () {
        settings.greetingPickerEnabled = this.checked;
        saveSettings();
    });
    $("#llmt-s-trans-enabled").prop("checked", settings.translateEnabled).on("change", function () {
        settings.translateEnabled = this.checked;
        saveSettings();
        if (settings.enabled) addMessageButtons();
        if (!this.checked) {
            // Remove all translate buttons and restore original text
            $('.llm-translate-btn').remove();
            llmtRestoreAllTranslations();
        }
    });
    $("#llmt-s-trans-lang").val(settings.translateLang).on("change", function () {
        settings.translateLang = this.value.trim() || "Russian";
        saveSettings();
    });
    $("#llmt-s-dyncap").prop("checked", settings.dynCaptionEnabled).on("change", function () {
        settings.dynCaptionEnabled = this.checked;
        saveSettings();
        $("#llmt-s-dyncap-confirm-row").toggle(this.checked);
    });
    renderSkipChipSettings();
    $("#llmt-s-chip-add").on("click", function () { addSkipChipFromInput(); });
    $("#llmt-s-chip-new").on("keydown", function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); addSkipChipFromInput(); }
    });
    $("#llmt-s-chip-reset").on("click", function () {
        if (!confirm("Restore the default Time Skip shortcuts? Your custom ones will be removed.")) return;
        settings.timeSkipChips = DEFAULT_SKIP_CHIPS.slice();
        saveSettings();
        renderSkipChipSettings();
        renderSkipChips();
    });

    $("#llmt-s-dyncap-confirm-row").toggle(!!settings.dynCaptionEnabled);
    $("#llmt-s-dyncap-confirm").prop("checked", settings.dynCaptionConfirm).on("change", function () {
        settings.dynCaptionConfirm = this.checked;
        saveSettings();
    });
}

/** Renders the editable shortcut list in the extension settings panel. */
function renderSkipChipSettings() {
    var $list = $('#llmt-s-chips-list');
    if (!$list.length) return;
    $list.empty();

    var list = Array.isArray(settings.timeSkipChips) ? settings.timeSkipChips : [];
    if (!list.length) {
        $list.append('<small class="llmt-s-chips-empty">No shortcuts — add one below.</small>');
        return;
    }

    list.forEach(function (label, idx) {
        var $row = $('<div class="llmt-s-chip-row"></div>');
        $('<span class="llmt-s-chip-label"></span>').text(label).appendTo($row);
        $('<div class="llmt-s-chip-del" title="Remove"><i class="fa-solid fa-xmark"></i></div>')
            .on('click', function () {
                settings.timeSkipChips.splice(idx, 1);
                saveSettings();
                renderSkipChipSettings();
                renderSkipChips();
            }).appendTo($row);
        $list.append($row);
    });
}

/** Adds the shortcut currently typed in the settings input. */
function addSkipChipFromInput() {
    var $input = $('#llmt-s-chip-new');
    var val = ($input.val() || '').trim();
    if (!val) return;
    if (!Array.isArray(settings.timeSkipChips)) settings.timeSkipChips = [];

    var exists = settings.timeSkipChips.some(function (c) {
        return c.toLowerCase() === val.toLowerCase();
    });
    if (exists) { $input.val(''); return; }

    settings.timeSkipChips.push(val);
    saveSettings();
    $input.val('');
    renderSkipChipSettings();
    renderSkipChips();
}

function buildVnUI() {
    if (!$('#llmt-vn-style').length) {
        $('head').append('<style id="llmt-vn-style"></style>');
    }
    
    let btnHtml = `
    <div id="llmt-vn-next" class="llmt-vn-next-btn">
        Continue <i class="fa-solid fa-chevron-right"></i>
    </div>`;
    $('body').append(btnHtml);
    
    $('#llmt-vn-next').on('click', function() {
        let $lastMes = $('#chat .mes').last();
        let textChunkCount = getVnTextChunks($lastMes).length;
        if (vnCurrentChunkIndex < textChunkCount - 1) {
            vnCurrentChunkIndex++;
            // Record what the user just read so we can rely on it even if
            // something resets vnCurrentChunkIndex before MESSAGE_SENT fires.
            try { vnRecordReadHighWater(vnCurrentChunkIndex + 1); } catch (e) {}
            updateVnView({ advanced: true });
            var $chat = $('#chat');
            if ($chat.length) $chat.scrollTop($chat[0].scrollHeight);
        }
    });
}

/**
 * Returns the array of "real" text chunks inside .mes_text, excluding
 * extension-injected elements like AutoIllustrator's illustration wrappers.
 * These auxiliary elements should be visually attached to the preceding chunk
 * rather than counted as a separate VN step.
 */
function getVnTextChunks($mes) {
    if (!$mes || !$mes.length) return [];
    let $mesText = $mes.find('.mes_text');
    if (!$mesText.length) return [];
    let chunks = [];
    $mesText.children().each(function() {
        let el = this;
        // Skip illustration wrappers, gallery widgets, and any element marked as auxiliary
        if (el.classList && (
            el.classList.contains('ai-illustration-wrapper') ||
            el.classList.contains('llmt-vn-aux') ||
            el.classList.contains('av-msg-btn')
        )) return;
        chunks.push(el);
    });
    return chunks;
}

/**
 * Returns plain text of the current visible VN chunk on the last AI message,
 * or null if VN is inactive / no message available.
 */
function getCurrentVnChunkText() {
    if (!settings.visualNovelMode) return null;
    let $lastMes = $('#chat .mes').last();
    if (!$lastMes.length || $lastMes.attr('is_user') === 'true') return null;
    let chunks = getVnTextChunks($lastMes);
    if (!chunks.length) return null;
    let idx = Math.max(0, Math.min(vnCurrentChunkIndex, chunks.length - 1));
    return $(chunks[idx]).text().trim();
}

function emitVnEvent(name, detail) {
    try {
        document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (e) { /* ignore */ }
}

function updateVnView(opts) {
    opts = opts || {};
    if (!settings.visualNovelMode) {
        $('#llmt-vn-next').hide();
        $('#llmt-vn-style').html('');
        return;
    }

    let $lastMes = $('#chat .mes').last();
    if (!$lastMes.length) return;

    if ($lastMes.attr('is_user') === 'true') {
        $('#llmt-vn-next').hide();
        // For user messages, show everything inside .mes_text
        $('#llmt-vn-style').html(`
            body.llmt-vn-mode #chat .mes:last-child .mes_text > * { display: block !important; }
        `);
        return;
    }

    let $mesText = $lastMes.find('.mes_text');
    if (!$mesText.length) {
        $('#llmt-vn-style').html('');
        $('#llmt-vn-next').hide();
        return;
    }

    // Build a list of all DOM children, marking which are "text chunks" (real
    // VN steps) vs "auxiliary" (AutoIllustrator images, gallery wrappers, etc.)
    let allChildren = $mesText.children().toArray();
    let chunkInfo = []; // { el, isAux }
    for (let el of allChildren) {
        let isAux = !!(el.classList && (
            el.classList.contains('ai-illustration-wrapper') ||
            el.classList.contains('llmt-vn-aux')
        ));
        chunkInfo.push({ el: el, isAux: isAux });
    }
    let textChunks = chunkInfo.filter(c => !c.isAux).map(c => c.el);
    let totalChunks = textChunks.length;

    if (totalChunks === 0) {
        // Only auxiliary children (or nothing) — clear inline display states
        $mesText.children().each(function() {
            this.style.display = '';
        });
        $('#llmt-vn-style').html('');
        $('#llmt-vn-next').hide();
        return;
    }

    if (vnCurrentChunkIndex >= totalChunks && (!scriptModule || !scriptModule.is_generating)) {
        vnCurrentChunkIndex = totalChunks - 1;
    }
    if (vnCurrentChunkIndex < 0) vnCurrentChunkIndex = 0;

    // The base CSS rule hides everything; we then inline-style what should be visible.
    $('#llmt-vn-style').html(`
        body.llmt-vn-mode #chat .mes:last-child .mes_text > * { display: none; }
    `);

    // Find the index in chunkInfo of the visible text chunk
    let visibleTextChunkIdx = vnCurrentChunkIndex;
    let chunkInfoIdx = -1;
    let textCounter = 0;
    for (let i = 0; i < chunkInfo.length; i++) {
        if (!chunkInfo[i].isAux) {
            if (textCounter === visibleTextChunkIdx) {
                chunkInfoIdx = i;
                break;
            }
            textCounter++;
        }
    }

    // Reset every child's inline display first (so previously-shown ones get hidden)
    for (let i = 0; i < chunkInfo.length; i++) {
        chunkInfo[i].el.style.display = 'none';
    }

    if (chunkInfoIdx >= 0) {
        // Show the selected text chunk
        chunkInfo[chunkInfoIdx].el.style.display = 'block';
        chunkInfo[chunkInfoIdx].el.style.animation = 'llmtVnFadeIn 0.35s ease';

        // Show any AUX siblings that immediately follow this chunk, up to the
        // next non-aux sibling. This keeps illustrations attached to the chunk
        // they were generated for.
        for (let j = chunkInfoIdx + 1; j < chunkInfo.length; j++) {
            if (chunkInfo[j].isAux) {
                chunkInfo[j].el.style.display = 'block';
            } else {
                break;
            }
        }

        // Also show any AUX siblings that precede the FIRST text chunk
        // (uncommon, but defensive).
        if (visibleTextChunkIdx === 0) {
            for (let j = 0; j < chunkInfoIdx; j++) {
                if (chunkInfo[j].isAux) {
                    chunkInfo[j].el.style.display = 'block';
                }
            }
        }
    }

    let isGenerating = !!(scriptModule && scriptModule.is_generating);
    if (vnCurrentChunkIndex < totalChunks - 1 || isGenerating) {
        // Show Continue button if there are more chunks already, OR if more
        // are still streaming in (button stays grey-disabled in that case).
        let canAdvance = vnCurrentChunkIndex < totalChunks - 1;
        $('#llmt-vn-next').css('display', 'flex')
            .toggleClass('llmt-vn-next-disabled', !canAdvance);
    } else {
        $('#llmt-vn-next').hide().removeClass('llmt-vn-next-disabled');
    }

    // Notify other extensions (e.g. AutoVoice) that the visible chunk changed.
    // Dedupe on (last AI mes index, chunk index) so toggling VN on/off, swiping,
    // or re-rendering the same chunk doesn't re-trigger downstream playback.
    //
    // Emit only in safe situations:
    //   (a) generation has fully ended (most common path — autoplay of
    //       chunk 0 fires when the LLM finishes);
    //   (b) the user clicked Continue and the chunk they just moved to
    //       has a successor in the DOM, which proves the renderer has
    //       finalized it (the next <p> would not exist otherwise).
    //
    // We intentionally do NOT emit purely because the chunk count grew
    // mid-stream. In practice the DOM is not reliably stable at that
    // exact mutation tick: a translate extension may be in the middle of
    // rewriting .mes_text, or the renderer may have just inserted the
    // next <p> while still finalizing the previous one. Downstream
    // consumers (AutoVoice → XTTS) then receive truncated text and
    // either pronounce broken syllables or, with strict backends, return
    // a 500. Streaming previews are not worth that fragility — we wait
    // for the end of generation.
    let chunkText = chunkInfoIdx >= 0 ? $(chunkInfo[chunkInfoIdx].el).text().trim() : '';
    let lastMesId = $lastMes.attr('mesid') || $lastMes.attr('mes_id') || '?';
    let emitKey = lastMesId + '|' + vnCurrentChunkIndex;
    vnLastSeenTotalChunks = totalChunks;
    let userAdvancedToStableChunk = !!opts.advanced && (vnCurrentChunkIndex < totalChunks - 1);
    let safeToEmit = !isGenerating || userAdvancedToStableChunk;
    let shouldEmit = safeToEmit &&
                     (opts.advanced || opts.force) &&
                     emitKey !== vnLastEmittedKey;
    if (shouldEmit) {
        if (chunkText) vnLastEmittedKey = emitKey;
        emitVnEvent('llmt:vn-chunk-advance', {
            mesId: lastMesId,
            index: vnCurrentChunkIndex,
            total: totalChunks,
            text: chunkText,
            isLast: vnCurrentChunkIndex >= totalChunks - 1,
            isGenerating: isGenerating
        });
    }
}

/**
 * Compute a stable identity key for an AI message: its chat index plus a
 * short hash of the source text. The hash survives translate extensions
 * toggling display_text on/off, but changes if the underlying message
 * itself is swapped (swipe, edit).
 */
function vnMesKey(ai) {
    if (!ai || !ai.mes) return null;
    var src = (typeof ai.mes.mes === 'string' ? ai.mes.mes : '') || '';
    var head = src.slice(0, 80);
    return String(ai.id) + '|' + head;
}

/**
 * Record that the user has read `paragraphsRead` paragraphs of the current
 * last AI message. Only ever grows — never shrinks — for a given mesKey.
 * Called from the Continue click handler so the value survives later DOM
 * observer-driven resets of vnCurrentChunkIndex.
 */
function vnRecordReadHighWater(paragraphsRead) {
    var ai = findLastAiMessage();
    if (!ai) return;
    var key = vnMesKey(ai);
    if (!key) return;
    if (vnLastReadHighWater.mesKey !== key) {
        vnLastReadHighWater = { mesKey: key, paragraphsRead: paragraphsRead };
    } else if (paragraphsRead > vnLastReadHighWater.paragraphsRead) {
        vnLastReadHighWater.paragraphsRead = paragraphsRead;
    }
}

/**
 * Locate the last AI (non-user, non-system) message in chat[].
 * Returns { id, mes } or null. We can't trust chat.length-2 because
 * MESSAGE_SENT may fire before or after the user's message has been
 * pushed onto chat[] depending on ST build, and there may be system
 * messages mixed in.
 */
function findLastAiMessage() {
    if (!scriptModule || !scriptModule.chat) return null;
    let chat = scriptModule.chat;
    for (let i = chat.length - 1; i >= 0; i--) {
        let m = chat[i];
        if (!m) continue;
        if (m.is_user) continue;
        if (m.is_system) continue;
        return { id: i, mes: m };
    }
    return null;
}

/**
 * Split a piece of message text into "paragraph" blocks the same way
 * SillyTavern's markdown renderer does: one or more blank lines separate
 * blocks. Preserves single newlines inside a block.
 */
function llmtSplitParagraphs(text) {
    if (!text) return [];
    return text.split(/(?:\r?\n){2,}/);
}

/**
 * Trim a message text down to its first `keepCount` paragraphs.
 * If keepCount exceeds the actual number of paragraphs, returns the
 * original untouched. Returns null when nothing should change.
 */
function llmtTrimToParagraphs(text, keepCount) {
    if (!text || keepCount < 1) return null;
    let parts = llmtSplitParagraphs(text);
    if (keepCount >= parts.length) return null; // nothing to trim
    return parts.slice(0, keepCount).join('\n\n');
}

/**
 * After the user sends a message in VN mode, rewrite the last AI message
 * so it contains only the chunks the user actually read.
 *
 * Why we don't rely on the DOM of the AI message:
 *   - Chat Translation and similar extensions replace .mes_text contents
 *     with a single translated block or restructure paragraphs, so the
 *     DOM chunk count of the AI message no longer matches the source.
 *   - SillyTavern keeps the original in `mes.mes` and the translated
 *     display copy in `mes.extra.display_text`. The "Show Original"
 *     toggle on a message reads from `mes.mes`. Both must be trimmed
 *     in lockstep, otherwise one of them gets out of sync (which is
 *     exactly the bug where Show Original returned just one paragraph).
 *
 * Strategy:
 *   1. We trust vnCurrentChunkIndex — it's the source of truth for how
 *      many Continue clicks the user made on this message. (Index N
 *      means N+1 paragraphs are visible.)
 *   2. We split mes.mes by blank lines and keep the first (N+1) parts.
 *   3. We do the same to mes.extra.display_text independently, if it
 *      exists. Translation providers translate paragraph-by-paragraph,
 *      so the paragraph indexing lines up between the two even though
 *      the text content differs.
 *   4. If a text has fewer paragraphs than we want to keep (rare —
 *      means the translator merged paragraphs), we leave that one alone
 *      rather than mangle it.
 *   5. We let SillyTavern re-render the message via updateMessageBlock /
 *      messageFormatting so it correctly picks display_text vs mes.
 */
function trimUnreadVnFragments() {
    let ai = findLastAiMessage();
    if (!ai) return;

    // Determine how many paragraphs the user has actually seen. Prefer the
    // sticky high-water record (set from Continue clicks) since
    // vnCurrentChunkIndex can be transiently reset to 0 by DOM observers
    // or extension-driven .mes_text rewrites between Send and MESSAGE_SENT.
    let keyForThisMes = vnMesKey(ai);
    let stickyRead = (vnLastReadHighWater.mesKey === keyForThisMes)
        ? vnLastReadHighWater.paragraphsRead : 0;
    let liveRead = (vnCurrentChunkIndex | 0) + 1;
    let keepCount = Math.max(stickyRead, liveRead);
    if (keepCount < 1) keepCount = 1;

    let mesObj = ai.mes;
    let changed = false;

    // 1) Trim the source/original text (this is what goes to the LLM).
    let trimmedMes = llmtTrimToParagraphs(mesObj.mes, keepCount);
    if (trimmedMes !== null) {
        mesObj.mes = trimmedMes;
        changed = true;
    }

    // 2) Trim the translated display copy, if present. Keep them in sync.
    if (mesObj.extra && typeof mesObj.extra.display_text === 'string' && mesObj.extra.display_text.length) {
        let trimmedDisplay = llmtTrimToParagraphs(mesObj.extra.display_text, keepCount);
        if (trimmedDisplay !== null) {
            mesObj.extra.display_text = trimmedDisplay;
            changed = true;
        }
    }

    try {
        console.log('[LLM Tools] VN trim:',
            { aiMesId: ai.id, stickyRead: stickyRead, liveRead: liveRead,
              keepCount: keepCount, changed: changed,
              mesParas: llmtSplitParagraphs(mesObj.mes).length,
              displayParas: mesObj.extra && mesObj.extra.display_text
                  ? llmtSplitParagraphs(mesObj.extra.display_text).length : null });
    } catch (e) {}

    if (!changed) return;

    // Re-render this message's DOM so the visible text matches storage.
    // Prefer SillyTavern's own updateMessageBlock when available — it
    // knows about display_text and reasoning blocks. Fall back to a
    // manual .mes_text rewrite using whichever text the user sees.
    let rendered = false;
    try {
        var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
            ? SillyTavern.getContext() : null;
        if (ctx && typeof ctx.updateMessageBlock === 'function') {
            ctx.updateMessageBlock(ai.id, mesObj);
            rendered = true;
        }
    } catch (e) { /* fall through to manual */ }

    if (!rendered) {
        try {
            let $aiMesNode = $('#chat .mes[mesid="' + ai.id + '"]');
            if (!$aiMesNode.length) {
                $aiMesNode = $('#chat .mes').filter(function() {
                    return $(this).attr('is_user') !== 'true';
                }).last();
            }
            let $mesText = $aiMesNode.find('.mes_text');
            if ($mesText.length) {
                // Prefer the translated display_text for the DOM (that's
                // what ST normally shows when a translation exists).
                let visibleText = (mesObj.extra && typeof mesObj.extra.display_text === 'string'
                                   && mesObj.extra.display_text.length)
                    ? mesObj.extra.display_text
                    : mesObj.mes;
                $mesText.html(llmtRenderMarkdown(visibleText));
            }
        } catch (e) {
            console.warn('[LLM Tools] Could not re-render trimmed VN message:', e);
        }
    }

    safeSaveChat();
}

/**
 * Toggle SillyTavern's native "Visual Novel Mode" (waifuMode) checkbox
 * to match our extension's VN state. Doing it via .click() lets ST run
 * its own onChange handler — that updates power_user.waifuMode, applies
 * the layout class, redraws sprites, and saves settings. We avoid a
 * double-toggle by checking the current state first.
 */
function syncNativeWaifuMode(enable) {
    try {
        var $cb = $('#waifuMode');
        if (!$cb.length) return;
        var current = $cb.prop('checked');
        if (current === !!enable) return; // already in desired state
        $cb.trigger('click');
    } catch (e) { /* non-fatal */ }
}

function applyVisualNovelMode() {
    // Mirror state into ST's native Visual Novel Mode setting so the user
    // gets sprite layout, background visibility, etc. without having to
    // toggle two checkboxes.
    syncNativeWaifuMode(!!settings.visualNovelMode);

    if (settings.visualNovelMode) {
        $('body').addClass('llmt-vn-mode');
        var $chat = $('#chat');
        if ($chat.length) $chat.scrollTop($chat[0].scrollHeight);
        startVnDomObserver();
        updateVnView({ force: true });
    } else {
        $('body').removeClass('llmt-vn-mode');
        $('#llmt-vn-next').hide();
        $('#llmt-vn-style').html('');
        stopVnDomObserver();
        // Clear any inline display:none we set on .mes_text children so the
        // chat shows normally again.
        $('#chat .mes .mes_text > *').each(function() {
            this.style.display = '';
            this.style.animation = '';
        });
    }
}

/* ------------------------------------------------------------------
 * VN DOM observer
 *
 * Some extensions (notably AutoIllustrator) inject children into
 * .mes_text after the message has rendered, without triggering any
 * SillyTavern event we listen to. Without re-running updateVnView,
 * those new children inherit the base "display: none" rule and stay
 * invisible. The observer below catches those mutations and refreshes
 * the VN view a few hundred ms later (debounced).
 * ------------------------------------------------------------------ */
var vnDomObserver = null;
var vnDomDebounceTimer = null;

function startVnDomObserver() {
    if (vnDomObserver) return;
    var chatEl = document.getElementById('chat');
    if (!chatEl) return;
    vnDomObserver = new MutationObserver(function() {
        if (!settings.visualNovelMode) return;
        if (vnDomDebounceTimer) clearTimeout(vnDomDebounceTimer);
        vnDomDebounceTimer = setTimeout(function() {
            updateVnView();
        }, 120);
    });
    vnDomObserver.observe(chatEl, { childList: true, subtree: true });
}

function stopVnDomObserver() {
    if (vnDomObserver) {
        try { vnDomObserver.disconnect(); } catch (e) { /* */ }
        vnDomObserver = null;
    }
    if (vnDomDebounceTimer) {
        clearTimeout(vnDomDebounceTimer);
        vnDomDebounceTimer = null;
    }
}

function buildWidget() {
    var h = `
    <div id="llm-tools-widget">
        <div class="llmt-drag-handle" title="Drag to move"><i class="fa-solid fa-grip-vertical"></i></div>
        <div class="llmt-btn llmt-btn-erase"    id="llmt-w-erase"    title="Quick Erase Last Message"><i class="fa-solid fa-bolt"></i></div>
        <div class="llmt-btn llmt-btn-continue" id="llmt-w-continue" title="Continue Generation"><i class="fa-solid fa-arrow-right"></i></div>
        <div class="llmt-btn llmt-btn-rethink"  id="llmt-w-rethink"  title="Rethink Last Message"><i class="fa-solid fa-brain"></i></div>
        <label title="Auto Rethink"><input type="checkbox" id="llmt-w-auto"> Auto</label>
        <select id="llmt-w-mode" title="Rethink Mode">`;
    for (var key in RETHINK_MODES) {
        var sel = (key === settings.rethinkMode) ? 'selected' : '';
        h += `<option value="${key}" ${sel}>${RETHINK_MODES[key].label}</option>`;
    }
    h += `</select>
        <div class="llmt-btn llmt-btn-action" id="llmt-w-action" title="Perform an Action">
            <i class="fa-solid fa-person-running"></i> Action
        </div>
        <div class="llmt-btn llmt-btn-speak" id="llmt-w-speak" title="Say Something">
            <i class="fa-solid fa-comment"></i> Speak
        </div>
        <div class="llmt-btn llmt-btn-think" id="llmt-w-think" title="Think Something">
            <i class="fa-solid fa-lightbulb"></i> Think
        </div>
        <div class="llmt-btn llmt-btn-time" id="llmt-w-time" title="Time Skip">
            <i class="fa-solid fa-clock-rotate-left"></i> Skip
        </div>
        <div class="llmt-btn llmt-btn-vn" id="llmt-w-vn" title="Visual Novel Mode — show only last message">
            <i class="fa-solid fa-book-open"></i> VN
        </div>
    </div>`;

    $('body').append(h);

    $("#llmt-w-erase").on("click", async function () {
        if (!scriptModule || !scriptModule.chat || scriptModule.is_generating) return;
        var chat = scriptModule.chat;
        if (chat.length === 0) return;
        var lastMesId = chat.length - 1;
        if (lastMesId === 0) return;
        chat.splice(lastMesId, 1);
        $('.mes[mesid="' + lastMesId + '"]').remove();
        await safeSaveChat();
        if (scriptModule.eventSource) scriptModule.eventSource.emit(scriptModule.event_types.MESSAGE_DELETED, lastMesId);
    });

    $("#llmt-w-continue").on("click", function () { triggerContinue(); });

    $("#llmt-w-rethink").on("click", function () {
        if (!scriptModule || !scriptModule.chat || scriptModule.is_generating) return;
        var $lastMes = $('.mes').last();
        if (!$lastMes.length) return;
        var lastMesId = parseInt($lastMes.attr('mesid'), 10);
        if (isNaN(lastMesId) || lastMesId === 0) return;
        var targetMes = scriptModule.chat[lastMesId];
        if (targetMes && !targetMes.is_user) startManualRethink(lastMesId, $lastMes);
    });

    $("#llmt-w-auto").prop("checked", settings.autoRethink).on("change", function () {
        settings.autoRethink = this.checked;
        saveSettings();
        $("#llmt-s-auto").prop("checked", this.checked);
        if (!this.checked) cleanupAutoRethink();
    });
    $("#llmt-w-mode").on("change", function () {
        settings.rethinkMode = this.value;
        saveSettings();
        $("#llmt-s-mode").val(this.value);
    });

    $("#llmt-w-action").on("click", function () { openActionDialog(); });
    $("#llmt-w-speak").on("click",  function () { openSpeakDialog(); });
    $("#llmt-w-think").on("click",  function () { openThinkDialog(); });
    $("#llmt-w-time").on("click",   function () { openTimeSkipDialog(); });
    $("#llmt-w-vn").on("click", function () {
        settings.visualNovelMode = !settings.visualNovelMode;
        saveSettings();
        applyVisualNovelMode();
        $(this).toggleClass("active", settings.visualNovelMode);
        updateVnActiveState();
        $("#llmt-s-vn").prop("checked", settings.visualNovelMode);
    }).toggleClass("active", !!settings.visualNovelMode);
}

function updateWidgetVisibility() {
    if (settings.enabled && settings.widgetEnabled) {
        var style = settings.widgetStyle || 'classic';
        $('#llm-tools-widget').toggle(style === 'classic');
        $('#llmt-rb').toggle(style === 'radial-bloom');
        $('#llmt-af').toggle(style === 'arc-fan');
        $('#llmt-mo').toggle(style === 'minimal-orb');
    } else {
        $('#llm-tools-widget, #llmt-rb, #llmt-af, #llmt-mo').hide();
    }
}

function applyEnabledState() {
    updateWidgetVisibility();
    if (settings.enabled) addMessageButtons();
    else $('.llm-tool-btn').remove();
}

function applyWidgetPosition() {
    var $all = $('#llm-tools-widget, #llmt-rb, #llmt-af, #llmt-mo');
    $all.removeClass('llmt-pos-bottom-center llmt-pos-top-center llmt-pos-top-right llmt-pos-bottom-right llmt-pos-custom');
    $all.css({ top: '', left: '', bottom: '', right: '', transform: '' });
    if (settings.widgetPosition === 'custom') {
        $all.addClass('llmt-pos-custom');
        $all.css({ left: settings.widgetX, top: settings.widgetY });
    } else {
        $all.addClass('llmt-pos-' + settings.widgetPosition);
    }
    var $mo = $('#llmt-mo');
    $mo.removeClass('llmt-mo-pos-bottom-center llmt-mo-pos-top-center llmt-mo-pos-top-right llmt-mo-pos-bottom-right');
    if (settings.widgetPosition !== 'custom') {
        $mo.addClass('llmt-mo-pos-' + settings.widgetPosition);
    }
}

function makeWidgetDraggable() {
    function attachDrag($w, $handle) {
        if (!$w.length || !$handle.length) return;
        $handle.on('mousedown', function (e) {
            if (settings.widgetPosition !== 'custom') return;
            e.preventDefault();
            e.stopPropagation();
            var startX = e.clientX, startY = e.clientY;
            var initialX = parseInt($w.css('left')) || 0;
            var initialY = parseInt($w.css('top'))  || 0;
            $('body').on('mousemove.llmdrag', function (e) {
                $w.css({ left: initialX + (e.clientX - startX) + 'px', top: initialY + (e.clientY - startY) + 'px', bottom: 'auto', right: 'auto', transform: 'none' });
            });
            $('body').on('mouseup.llmdrag', function () {
                $('body').off('mousemove.llmdrag mouseup.llmdrag');
                settings.widgetX = $w.css('left'); settings.widgetY = $w.css('top');
                saveSettings();
            });
        });
    }
    attachDrag($('#llm-tools-widget'), $('#llm-tools-widget').find('.llmt-drag-handle'));
    attachDrag($('#llmt-rb'), $('#llmt-rb-drag'));
    attachDrag($('#llmt-af'), $('#llmt-af-drag'));
    attachDrag($('#llmt-mo'), $('#llmt-mo-grip'));
}

function buildRadialWidgets() {
    buildRadialBloom();
    buildArcFan();
    buildMinimalOrb();
    makeWidgetDraggable();
	applyWidgetPosition();
    updateWidgetVisibility();
}

function llmtWidgetAction(action) {
    switch (action) {
        case 'erase':
            (async function () {
                if (!scriptModule || !scriptModule.chat || scriptModule.is_generating) return;
                var chat = scriptModule.chat;
                if (chat.length === 0) return;
                var lastMesId = chat.length - 1;
                if (lastMesId === 0) return;
                chat.splice(lastMesId, 1);
                $('.mes[mesid="' + lastMesId + '"]').remove();
                await safeSaveChat();
                if (scriptModule.eventSource) scriptModule.eventSource.emit(scriptModule.event_types.MESSAGE_DELETED, lastMesId);
            })();
            break;
        case 'continue':
            triggerContinue();
            break;
        case 'rethink':
            if (!scriptModule || !scriptModule.chat || scriptModule.is_generating) return;
            var $lastMes = $('.mes').last();
            if (!$lastMes.length) return;
            var lastMesId = parseInt($lastMes.attr('mesid'), 10);
            if (isNaN(lastMesId) || lastMesId === 0) return;
            var targetMes = scriptModule.chat[lastMesId];
            if (targetMes && !targetMes.is_user) startManualRethink(lastMesId, $lastMes);
            break;
        case 'action':
            openActionDialog();
            break;
        case 'speak':
            openSpeakDialog();
            break;
        case 'think':
            openThinkDialog();
            break;
        case 'time':
            openTimeSkipDialog();
            break;
        case 'vn':
            settings.visualNovelMode = !settings.visualNovelMode;
            saveSettings();
            applyVisualNovelMode();
            updateVnActiveState();
            $("#llmt-s-vn").prop("checked", settings.visualNovelMode);
            break;
    }
}

function updateVnActiveState() {
    var active = !!settings.visualNovelMode;
    $('#llmt-w-vn').toggleClass('active', active);
    $('.llmt-rad-item[data-action="vn"]').toggleClass('llmt-rad-active', active);
}

function updateAutoToggleUI() {
    var on = !!settings.autoRethink;
    $('.llmt-rad-auto-btn').toggleClass('llmt-rad-auto-on', on);
    $('#llmt-w-auto, #llmt-s-auto').prop('checked', on);
}

function buildRadialBloom() {
    var h = '<div id="llmt-rb" class="llmt-radial-wrap">';
    h += '<div id="llmt-rb-orb" class="llmt-orb" title="LLM Tools"><i class="fa-solid fa-bolt"></i></div>';
    h += '<div class="llmt-rad-auto-btn" id="llmt-rb-auto" title="Toggle Auto Rethink">A</div>';
    h += '<div class="llmt-rad-drag-handle" id="llmt-rb-drag" title="Drag to move"><i class="fa-solid fa-grip-vertical"></i></div>';
    WIDGET_ITEMS.forEach(function (item) {
        h += '<div class="llmt-rb-item llmt-rad-item" data-action="' + item.id + '" title="' + item.title + '" style="--item-color:' + item.color + '">'
           + '<i class="fa-solid ' + item.icon + '"></i>'
           + '<span class="llmt-rad-label">' + item.label + '</span>'
           + '</div>';
    });
    h += '</div>';
    $('body').append(h);

    var $items = $('#llmt-rb .llmt-rb-item');
    var R = 82, n = WIDGET_ITEMS.length;
    var cx = 22, cy = 22;
    $items.each(function (i) {
        var deg = (360 / n) * i - 90;
        var rad = deg * Math.PI / 180;
        var x = cx + R * Math.cos(rad);
        var y = cy + R * Math.sin(rad);
        $(this).data('tx', x).data('ty', y).css({ left: cx + 'px', top: cy + 'px', opacity: 0, transform: 'translate(-50%,-50%)' });
    });

    var rbOpen = false;
    $('#llmt-rb-orb').on('click', function (e) {
        e.stopPropagation();
        rbOpen = !rbOpen;
        $(this).toggleClass('llmt-orb-open', rbOpen);
        $items.each(function (i) {
            var $item = $(this);
            if (rbOpen) {
                setTimeout(function () {
                    $item.addClass('llmt-rad-visible').css({ left: $item.data('tx') + 'px', top: $item.data('ty') + 'px', opacity: 1 });
                }, i * 35);
            } else {
                $item.removeClass('llmt-rad-visible').css({ left: cx + 'px', top: cy + 'px', opacity: 0 });
            }
        });
    });
    
    $('#llmt-rb').on('click', '.llmt-rb-item', function (e) {
        e.stopPropagation();
        llmtWidgetAction($(this).data('action'));
    });
    $('#llmt-rb-auto').on('click', function (e) {
        e.stopPropagation();
        settings.autoRethink = !settings.autoRethink;
        saveSettings();
        if (!settings.autoRethink) cleanupAutoRethink();
        updateAutoToggleUI();
    });
    updateVnActiveState();
    updateAutoToggleUI();
}

function buildArcFan() {
    var h = '<div id="llmt-af" class="llmt-radial-wrap">';
    h += '<div id="llmt-af-orb" class="llmt-orb" title="LLM Tools"><i class="fa-solid fa-bolt"></i></div>';
    h += '<div class="llmt-rad-auto-btn" id="llmt-af-auto" title="Toggle Auto Rethink">A</div>';
    h += '<div class="llmt-rad-drag-handle" id="llmt-af-drag" title="Drag to move"><i class="fa-solid fa-grip-vertical"></i></div>';
    WIDGET_ITEMS.forEach(function (item) {
        h += '<div class="llmt-af-item llmt-rad-item" data-action="' + item.id + '" title="' + item.title + '" style="--item-color:' + item.color + '">'
           + '<i class="fa-solid ' + item.icon + '"></i>'
           + '<span class="llmt-rad-label">' + item.label + '</span>'
           + '</div>';
    });
    h += '</div>';
    $('body').append(h);

    var $items = $('#llmt-af .llmt-af-item');
    var R = 82, n = WIDGET_ITEMS.length;
    var cx = 22, cy = 22;
    var spreadDeg = 120;
    $items.each(function (i) {
        var frac = n > 1 ? i / (n - 1) : 0.5;
        var deg = (-90 - spreadDeg / 2) + frac * spreadDeg;
        var rad = deg * Math.PI / 180;
        var x = cx + R * Math.cos(rad);
        var y = cy + R * Math.sin(rad);
        $(this).data('tx', x).data('ty', y).css({ left: cx + 'px', top: cy + 'px', opacity: 0, transform: 'translate(-50%,-50%)' });
    });

    var afOpen = false;
    $('#llmt-af-orb').on('click', function (e) {
        e.stopPropagation();
        afOpen = !afOpen;
        $(this).toggleClass('llmt-orb-open', afOpen);
        $items.each(function (i) {
            var $item = $(this);
            if (afOpen) {
                setTimeout(function () {
                    $item.addClass('llmt-rad-visible').css({ left: $item.data('tx') + 'px', top: $item.data('ty') + 'px', opacity: 1 });
                }, i * 30);
            } else {
                $item.removeClass('llmt-rad-visible').css({ left: cx + 'px', top: cy + 'px', opacity: 0 });
            }
        });
    });
    
    $('#llmt-af').on('click', '.llmt-af-item', function (e) {
        e.stopPropagation();
        llmtWidgetAction($(this).data('action'));
    });
    $('#llmt-af-auto').on('click', function (e) {
        e.stopPropagation();
        settings.autoRethink = !settings.autoRethink;
        saveSettings();
        if (!settings.autoRethink) cleanupAutoRethink();
        updateAutoToggleUI();
    });
    updateVnActiveState();
    updateAutoToggleUI();
}

function buildMinimalOrb() {
    var h = '<div id="llmt-mo" class="llmt-mo-root">';
    h += '<div class="llmt-mo-grip" id="llmt-mo-grip" title="Drag to move"><i class="fa-solid fa-grip-vertical"></i></div>';
    h += '<div class="llmt-rad-auto-btn llmt-mo-auto-btn" id="llmt-mo-auto" title="Toggle Auto Rethink">A</div>';
    h += '<div id="llmt-mo-orb" class="llmt-orb" title="LLM Tools"><i class="fa-solid fa-bolt"></i></div>';
    h += '<div id="llmt-mo-popup" class="llmt-mo-popup">';
    WIDGET_ITEMS.slice().reverse().forEach(function (item) {
        h += '<div class="llmt-mo-row">'
           + '<span class="llmt-mo-lbl">' + item.label + '</span>'
           + '<div class="llmt-mo-btn llmt-rad-item" data-action="' + item.id + '" title="' + item.title + '" style="--item-color:' + item.color + '"><i class="fa-solid ' + item.icon + '"></i></div>'
           + '</div>';
    });
    h += '</div>';
    h += '</div>';
    $('body').append(h);

    var moOpen = false;
    $('#llmt-mo-orb').on('click', function (e) {
        e.stopPropagation();
        moOpen = !moOpen;
        $(this).toggleClass('llmt-orb-open', moOpen);
        $('#llmt-mo-popup').toggleClass('llmt-mo-open', moOpen);
    });
    
    $('#llmt-mo').on('click', '.llmt-mo-btn', function (e) {
        e.stopPropagation();
        llmtWidgetAction($(this).data('action'));
    });
    $('#llmt-mo-auto').on('click', function (e) {
        e.stopPropagation();
        settings.autoRethink = !settings.autoRethink;
        saveSettings();
        if (!settings.autoRethink) cleanupAutoRethink();
        updateAutoToggleUI();
    });
    updateVnActiveState();
    updateAutoToggleUI();
}

function buildActionUI() {
    var h = `
    <div id="llmt-action-overlay">
        <div id="llmt-action-modal">
            <div class="llmt-modal-header">
                <i class="fa-solid fa-person-running" style="color:#a78bfa"></i>
                <span>Perform an Action</span>
                <span class="llmt-modal-close" id="llmt-action-close">✕</span>
            </div>
            <div class="llmt-modal-hint">
                Describe what your character does. It will be wrapped in <b>*asterisks*</b>.
            </div>
            <textarea id="llmt-action-text" class="llmt-modal-textarea" placeholder="e.g. walks over to the window and looks outside..."></textarea>
            <div class="llmt-action-preview" id="llmt-action-preview"></div>
            <div class="llmt-action-ai-row">
                <label class="llmt-action-ai-label" title="Rephrase your action via the current LLM into a more vivid, literary form">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <span>AI Enhance</span>
                    <div class="llmt-ai-toggle" id="llmt-action-ai-toggle">
                        <div class="llmt-ai-toggle-thumb"></div>
                    </div>
                </label>
                <div id="llmt-action-ai-status" class="llmt-action-ai-status"></div>
            </div>
            <div class="llmt-modal-actions">
                <button class="llmt-time-btn" id="llmt-action-cancel">Cancel</button>
                <button class="llmt-time-btn" id="llmt-action-confirm" style="background:#a78bfa;color:#000">
                    <i class="fa-solid fa-paper-plane"></i> Send Action
                </button>
            </div>
        </div>
    </div>`;
    $('body').append(h);

    $('#llmt-action-ai-toggle').on('click', function () { $(this).toggleClass('active'); updateActionPreview(); });
    $('#llmt-action-close, #llmt-action-cancel').on('click', function () { $('#llmt-action-overlay').fadeOut(200); });
    $('#llmt-action-overlay').on('click', function (e) { if ($(e.target).is('#llmt-action-overlay')) $(this).fadeOut(200); });
    
    $('#llmt-action-text').on('keydown', function (e) {
        e.stopPropagation();
        if (e.ctrlKey && e.key === 'Enter') $('#llmt-action-confirm').click();
        if (e.key === 'Escape') $('#llmt-action-overlay').fadeOut(200);
    });

    $('#llmt-action-text').on('input', updateActionPreview);

    $('#llmt-action-confirm').on('click', async function () {
        var rawText = $('#llmt-action-text').val().trim();
        if (!rawText) return;

        var aiEnhanceEnabled = $('#llmt-action-ai-toggle').hasClass('active');
        if (aiEnhanceEnabled) {
            var $btn = $(this);
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Rewriting...');
            $('#llmt-action-ai-status').text('✨ Rewriting via LLM…').addClass('active');

            try {
                var enhanced = await llmtEnhanceActionText(rawText);
                var formatted = '*' + enhanced + '*';
                $('#llmt-action-preview').text(formatted);
                $('#llmt-action-ai-status').text('✅ Done! Sending…');
                await new Promise(function (r) { setTimeout(r, 600); });
                $('#llmt-action-overlay').fadeOut(200);
                sendToChat(formatted);
            } catch (err) {
                $('#llmt-action-ai-status').text('❌ Error, sending as-is.').addClass('error');
                await new Promise(function (r) { setTimeout(r, 800); });
                $('#llmt-action-overlay').fadeOut(200);
                sendToChat('*' + rawText + '*');
            } finally {
                $btn.prop('disabled', false).html('<i class="fa-solid fa-paper-plane"></i> Send Action');
                $('#llmt-action-ai-status').text('').removeClass('active error');
            }
        } else {
            $('#llmt-action-overlay').fadeOut(200);
            sendToChat('*' + rawText + '*');
        }

        $('#llmt-action-text').val('');
        $('#llmt-action-preview').text('');
    });
}

function updateActionPreview() {
    var text = $('#llmt-action-text').val().trim();
    var $prev = $('#llmt-action-preview');
    var isEnhance = $('#llmt-action-ai-toggle').hasClass('active');

    if (!text) { $prev.text(''); return; }
    if (isEnhance) {
        $prev.css('font-style', 'italic').text('✨ AI will enhance your action before sending…');
    } else {
        $prev.css('font-style', 'normal').text('*' + text + '*');
    }
}

async function llmtEnhanceActionText(text) {
    var generateFn = (scriptModule && typeof scriptModule.generateQuietPrompt === 'function')
        ? scriptModule.generateQuietPrompt.bind(scriptModule)
        : (typeof generateQuietPrompt === 'function' ? generateQuietPrompt : null);

    if (!generateFn) throw new Error('generateQuietPrompt not available');

    var prompt = '[INST]You are a creative writing assistant for a roleplay session.\n'
        + 'Rephrase the following rough character action into a single, more vivid and descriptive narrative sentence.\n'
        + 'Rules: output ONLY the narrative text — no quotation marks, no spoken dialogue, no asterisks around the text, no commentary. Keep the original meaning. One or two sentences maximum.\n\n'
        + 'Original action: ' + text + '\n[/INST]';

    var result = await generateFn(prompt, false);
    if (!result || typeof result !== 'string') throw new Error('Empty response from LLM');

    result = result.replace(/^[*_"«»\u201c\u201d\s]+|[*_"«»\u201c\u201d\s]+$/g, '').trim();
    return result || text;
}

function openActionDialog() {
    $('#llmt-action-ai-toggle').removeClass('active');
    $('#llmt-action-ai-status').text('').removeClass('active error');
    updateActionPreview();
    
    $('#llmt-action-overlay').css('display', 'flex').hide().fadeIn(200);
    setTimeout(function () { $('#llmt-action-text').focus(); }, 220);
}

function buildThinkUI() {
    var h = `
    <div id="llmt-think-overlay">
        <div id="llmt-think-modal">
            <div class="llmt-modal-header">
                <i class="fa-solid fa-lightbulb" style="color:#f1c40f"></i>
                <span>Think Something</span>
                <span class="llmt-modal-close" id="llmt-think-close">✕</span>
            </div>
            <div class="llmt-modal-hint">
                Describe what your character thinks. It will be wrapped as inner thought: <b>*( ... )*</b>.
            </div>
            <textarea id="llmt-think-text" class="llmt-modal-textarea" placeholder="e.g. something feels off about this place..."></textarea>
            <div class="llmt-think-preview" id="llmt-think-preview"></div>
            <div class="llmt-think-ai-row">
                <label class="llmt-think-ai-label" title="Rephrase your thought via the current LLM into a more vivid, literary form">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <span>AI Enhance</span>
                    <div class="llmt-ai-toggle" id="llmt-think-ai-toggle">
                        <div class="llmt-ai-toggle-thumb"></div>
                    </div>
                </label>
                <div id="llmt-think-ai-status" class="llmt-think-ai-status"></div>
            </div>
            <div class="llmt-modal-actions">
                <button class="llmt-time-btn" id="llmt-think-cancel">Cancel</button>
                <button class="llmt-time-btn" id="llmt-think-confirm" style="background:#f1c40f;color:#000">
                    <i class="fa-solid fa-paper-plane"></i> Send Thought
                </button>
            </div>
        </div>
    </div>`;
    $('body').append(h);

    $('#llmt-think-ai-toggle').on('click', function () { $(this).toggleClass('active'); updateThinkPreview(); });
    $('#llmt-think-close, #llmt-think-cancel').on('click', function () { $('#llmt-think-overlay').fadeOut(200); });
    $('#llmt-think-overlay').on('click', function (e) { if ($(e.target).is('#llmt-think-overlay')) $(this).fadeOut(200); });
    
    $('#llmt-think-text').on('keydown', function (e) {
        e.stopPropagation();
        if (e.ctrlKey && e.key === 'Enter') $('#llmt-think-confirm').click();
        if (e.key === 'Escape') $('#llmt-think-overlay').fadeOut(200);
    });

    $('#llmt-think-text').on('input', updateThinkPreview);

    $('#llmt-think-confirm').on('click', async function () {
        var rawText = $('#llmt-think-text').val().trim();
        if (!rawText) return;

        var aiEnhanceEnabled = $('#llmt-think-ai-toggle').hasClass('active');
        if (aiEnhanceEnabled) {
            var $btn = $(this);
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Rewriting...');
            $('#llmt-think-ai-status').text('✨ Rewriting via LLM…').addClass('active');

            try {
                var enhanced = await llmtEnhanceThinkText(rawText);
                var formatted = buildThinkMessage(enhanced);
                $('#llmt-think-preview').text(formatted);
                $('#llmt-think-ai-status').text('✅ Done! Sending…');
                await new Promise(function (r) { setTimeout(r, 600); });
                $('#llmt-think-overlay').fadeOut(200);
                sendToChat(formatted);
            } catch (err) {
                $('#llmt-think-ai-status').text('❌ Error, sending as-is.').addClass('error');
                await new Promise(function (r) { setTimeout(r, 800); });
                $('#llmt-think-overlay').fadeOut(200);
                sendToChat(buildThinkMessage(rawText));
            } finally {
                $btn.prop('disabled', false).html('<i class="fa-solid fa-paper-plane"></i> Send Thought');
                $('#llmt-think-ai-status').text('').removeClass('active error');
            }
        } else {
            $('#llmt-think-overlay').fadeOut(200);
            sendToChat(buildThinkMessage(rawText));
        }

        $('#llmt-think-text').val('');
        $('#llmt-think-preview').text('');
    });
}

function buildThinkMessage(text) {
    return '*( ' + text + ' )*';
}

function updateThinkPreview() {
    var text = $('#llmt-think-text').val().trim();
    var $prev = $('#llmt-think-preview');
    var isEnhance = $('#llmt-think-ai-toggle').hasClass('active');

    if (!text) { $prev.text(''); return; }
    if (isEnhance) {
        $prev.css('font-style', 'italic').text('✨ AI will enhance your thought before sending…');
    } else {
        $prev.css('font-style', 'italic').text(buildThinkMessage(text));
    }
}

async function llmtEnhanceThinkText(text) {
    var generateFn = (scriptModule && typeof scriptModule.generateQuietPrompt === 'function')
        ? scriptModule.generateQuietPrompt.bind(scriptModule)
        : (typeof generateQuietPrompt === 'function' ? generateQuietPrompt : null);

    if (!generateFn) throw new Error('generateQuietPrompt not available');

    var prompt = '[INST]You are a creative writing assistant for a roleplay session.\n'
        + 'Rephrase the following rough inner thought of a character into a single, more vivid and introspective inner monologue line.\n'
        + 'Rules: output ONLY the inner-thought text — no quotation marks, no spoken dialogue, no asterisks, no parentheses, no commentary. It must read as something the character thinks silently to themselves. Keep the original meaning. One or two sentences maximum.\n\n'
        + 'Original thought: ' + text + '\n[/INST]';

    var result = await generateFn(prompt, false);
    if (!result || typeof result !== 'string') throw new Error('Empty response from LLM');

    result = result.replace(/^[*_"«»\u201c\u201d()\s]+|[*_"«»\u201c\u201d()\s]+$/g, '').trim();
    return result || text;
}

function openThinkDialog() {
    $('#llmt-think-ai-toggle').removeClass('active');
    $('#llmt-think-ai-status').text('').removeClass('active error');
    updateThinkPreview();
    
    $('#llmt-think-overlay').css('display', 'flex').hide().fadeIn(200);
    setTimeout(function () { $('#llmt-think-text').focus(); }, 220);
}

function buildSpeakUI() {
    var h = `
    <div id="llmt-speak-overlay">
        <div id="llmt-speak-modal">
            <div class="llmt-modal-header">
                <i class="fa-solid fa-comment" style="color:#5bc0de"></i>
                <span>Say Something</span>
                <span class="llmt-modal-close" id="llmt-speak-close">✕</span>
            </div>
            <div class="llmt-speak-target-row">
                <label class="llmt-speak-target-label">
                    <i class="fa-solid fa-user-group"></i> Speak to:
                </label>
                <select id="llmt-speak-target" class="llmt-speak-select">
                    <option value="">(everyone / no target)</option>
                </select>
            </div>
            <div class="llmt-modal-hint" id="llmt-speak-hint">
                What do you say? It will be wrapped in <b>"quotes"</b>.
            </div>
            <textarea id="llmt-speak-text" class="llmt-modal-textarea" placeholder="e.g. I didn't expect to see you here..."></textarea>
            <div class="llmt-speak-action-row">
                <label class="llmt-speak-action-label">
                    <i class="fa-solid fa-person-running"></i>
                    <span>While doing <small>(optional)</small>:</span>
                </label>
                <input type="text" id="llmt-speak-action" class="llmt-speak-action-input" placeholder="e.g. dancing, smiling, crossing arms...">
            </div>
            <div class="llmt-speak-preview" id="llmt-speak-preview"></div>
            <div class="llmt-speak-ai-row">
                <label class="llmt-speak-ai-label" title="Rephrase your text via the current LLM into a more vivid, literary form">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <span>AI Enhance</span>
                    <div class="llmt-ai-toggle" id="llmt-ai-toggle">
                        <div class="llmt-ai-toggle-thumb"></div>
                    </div>
                </label>
                <div id="llmt-speak-ai-status" class="llmt-speak-ai-status"></div>
            </div>
            <div class="llmt-modal-actions">
                <button class="llmt-time-btn" id="llmt-speak-cancel">Cancel</button>
                <button class="llmt-time-btn" id="llmt-speak-confirm" style="background:#5bc0de;color:#000">
                    <i class="fa-solid fa-paper-plane"></i> Send
                </button>
            </div>
        </div>
    </div>`;
    $('body').append(h);

    var aiEnhanceEnabled = false;
    $('#llmt-ai-toggle').on('click', function () {
        aiEnhanceEnabled = !aiEnhanceEnabled;
        $(this).toggleClass('active', aiEnhanceEnabled);
        updateSpeakPreview();
    });

    $('#llmt-speak-close, #llmt-speak-cancel').on('click', function () { $('#llmt-speak-overlay').fadeOut(200); });
    $('#llmt-speak-overlay').on('click', function (e) { if ($(e.target).is('#llmt-speak-overlay')) $(this).fadeOut(200); });
    $('#llmt-speak-text').on('keydown', function (e) {
        e.stopPropagation();
        if (e.ctrlKey && e.key === 'Enter') $('#llmt-speak-confirm').click();
        if (e.key === 'Escape') $('#llmt-speak-overlay').fadeOut(200);
    });

    $('#llmt-speak-text, #llmt-speak-target, #llmt-speak-action').on('input change', function () {
        updateSpeakHint();
        updateSpeakPreview();
    });

    $('#llmt-speak-confirm').on('click', async function () {
        var rawText = $('#llmt-speak-text').val().trim();
        if (!rawText) return;
        var target = $('#llmt-speak-target').val().trim();
        var action = $('#llmt-speak-action').val().trim();

        if (aiEnhanceEnabled) {
            var $btn = $(this);
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Rewriting...');
            $('#llmt-speak-ai-status').text('✨ Rewriting via LLM…').addClass('active');

            try {
                var enhanced = await llmtEnhanceSpeakText(rawText, target, action);
                var formatted = buildSpeakMessage(enhanced.text, target, enhanced.action);
                $('#llmt-speak-preview').text(formatted);
                $('#llmt-speak-ai-status').text('✅ Done! Sending…');
                await new Promise(function (r) { setTimeout(r, 600); });
                $('#llmt-speak-overlay').fadeOut(200);
                sendToChat(formatted);
            } catch (err) {
                $('#llmt-speak-ai-status').text('❌ Error, sending as-is.').addClass('error');
                await new Promise(function (r) { setTimeout(r, 800); });
                $('#llmt-speak-overlay').fadeOut(200);
                sendToChat(buildSpeakMessage(rawText, target, action));
            } finally {
                $btn.prop('disabled', false).html('<i class="fa-solid fa-paper-plane"></i> Send');
                $('#llmt-speak-ai-status').text('').removeClass('active error');
            }
        } else {
            $('#llmt-speak-overlay').fadeOut(200);
            sendToChat(buildSpeakMessage(rawText, target, action));
        }

        $('#llmt-speak-text').val('');
        $('#llmt-speak-action').val('');
        $('#llmt-speak-preview').text('');
    });
}

async function llmtEnhanceSpeakText(text, target, action) {
    var generateFn = (scriptModule && typeof scriptModule.generateQuietPrompt === 'function')
        ? scriptModule.generateQuietPrompt.bind(scriptModule)
        : (typeof generateQuietPrompt === 'function' ? generateQuietPrompt : null);

    if (!generateFn) throw new Error('generateQuietPrompt not available');

    var targetHint = target ? 'The character is addressing "' + target + '" directly.' : 'The character is speaking to everyone present.';
    var hasAction = action && action.trim().length > 0;

    var prompt;
    if (hasAction) {
        prompt = '[INST]You are a creative writing assistant for a roleplay session.\n'
            + targetHint + '\n'
            + 'Rewrite both the dialogue AND the action into more vivid and literary form.\n'
            + 'Output EXACTLY two lines, nothing else:\n'
            + 'LINE 1: enhanced spoken words only (no quotation marks, no asterisks)\n'
            + 'LINE 2: enhanced action description only (no asterisks, no quotation marks)\n'
            + 'Keep original meaning of both. One or two sentences each maximum.\n\n'
            + 'Dialogue: ' + text + '\n'
            + 'Action: ' + action.trim() + '\n[/INST]';
    } else {
        prompt = '[INST]You are a creative writing assistant for a roleplay session.\n'
            + targetHint + '\n'
            + 'Rephrase the following rough line of dialogue into a single, more vivid and literary spoken line.\n'
            + 'Rules: output ONLY the spoken words — no quotation marks, no asterisks, no action beats, no narration, no commentary. Keep the original meaning. One or two sentences maximum.\n\n'
            + 'Original line: ' + text + '\n[/INST]';
    }

    var result = await generateFn(prompt, false);
    if (!result || typeof result !== 'string') throw new Error('Empty response from LLM');

    result = result.trim();

    if (hasAction) {
        var lines = result.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
        var cleanLine = function (l) {
            return l.replace(/^line\s*[12]\s*[:\-]\s*/i, '').replace(/^["«»\u201c\u201d]+|["«»\u201c\u201d]+$/g, '').replace(/^\*+|\*+$/g, '').trim();
        };
        var enhancedText   = lines.length >= 1 ? cleanLine(lines[0]) : text;
        var enhancedAction = lines.length >= 2 ? cleanLine(lines[1]) : action.trim();
        return { text: enhancedText || text, action: enhancedAction || action.trim() };
    } else {
        result = result.replace(/^["«»\u201c\u201d\s]+|["«»\u201c\u201d\s]+$/g, '').trim();
        return { text: result || text, action: '' };
    }
}

function buildSpeakMessage(text, target, action) {
    var base = target ? '*Speak to ' + target + ':* "' + text + '"' : '"' + text + '"';
    if (action) base += ' *' + action + '*';
    return base;
}

function updateSpeakHint() {
    var target = $('#llmt-speak-target').val().trim();
    var $hint  = $('#llmt-speak-hint');
    if (target) {
        var safeName = $('<span>').text(target).html();
        $hint.html('Speaking to <b>' + safeName + '</b> — will add <b>*Speak to ' + safeName + ':*</b> before your line.');
    } else {
        $hint.html('Speaking to everyone — your line will be wrapped in <b>"quotes"</b>.');
    }
}

function updateSpeakPreview() {
    var text   = $('#llmt-speak-text').val().trim();
    var target = $('#llmt-speak-target').val().trim();
    var action = $('#llmt-speak-action').val().trim();
    var $prev  = $('#llmt-speak-preview');
    if (!text) { $prev.text(''); return; }
    if ($('#llmt-ai-toggle').hasClass('active')) {
        var aiPreview = '✨ AI will enhance your line before sending…';
        if (action) aiPreview += '\n*' + action + '*';
        $prev.css('font-style', 'italic').text(aiPreview);
    } else {
        $prev.css('font-style', 'normal').text(buildSpeakMessage(text, target, action));
    }
}

function openSpeakDialog() {
    var chars   = getChatCharacters();
    var isGroup = !!((scriptModule && scriptModule.selected_group) || window.selected_group);

    var $sel = $('#llmt-speak-target');
    $sel.empty().append('<option value="">(everyone / no target)</option>');
    chars.forEach(function (name) { $sel.append($('<option></option>').val(name).text(name)); });
    if (!isGroup && chars.length === 1) $sel.val(chars[0]);

    $('#llmt-ai-toggle').removeClass('active');
    $('#llmt-speak-action').val('');
    updateSpeakHint();
    updateSpeakPreview();
    $('#llmt-speak-ai-status').text('').removeClass('active error');
    $('#llmt-speak-overlay').css('display', 'flex').hide().fadeIn(200);
    setTimeout(function () { $('#llmt-speak-text').focus(); }, 220);
}

function buildTimeSkipUI() {
    var h = `
    <div id="llmt-time-overlay">
        <div id="llmt-time-modal">
            <div class="llmt-time-header">
                <i class="fa-solid fa-hourglass-half" id="llmt-hourglass"></i> Time Skip
            </div>
            <div class="llmt-skip-tabs">
                <div class="llmt-skip-tab llmt-skip-tab-active" data-mode="clock">
                    <i class="fa-solid fa-clock"></i> By Time
                </div>
                <div class="llmt-skip-tab" data-mode="action">
                    <i class="fa-solid fa-mug-saucer"></i> By Action
                </div>
            </div>
            <div class="llmt-skip-pane" id="llmt-skip-pane-clock">
                <div class="llmt-time-display">
                    <span id="llmt-disp-h">00</span><small>h</small>
                    <span id="llmt-disp-m">30</span><small>m</small>
                </div>
                <div class="llmt-sliders">
                    <label><span>Hours</span> <span id="llmt-lbl-h">0</span></label>
                    <input type="range" class="llmt-slider" id="llmt-range-h" min="0" max="72" value="0">
                    <label><span>Minutes</span> <span id="llmt-lbl-m">30</span></label>
                    <input type="range" class="llmt-slider" id="llmt-range-m" min="0" max="59" step="5" value="30">
                </div>
            </div>
            <div class="llmt-skip-pane" id="llmt-skip-pane-action" style="display:none">
                <div class="llmt-skip-action-hint">
                    Describe the activity to skip through — the LLM decides
                    <b>how long it takes</b> and narrates it.
                </div>
                <textarea id="llmt-skip-action-text" class="llmt-modal-textarea llmt-skip-action-text"
                          placeholder="e.g. have breakfast and get dressed…"></textarea>
                <div class="llmt-skip-chips" id="llmt-skip-chips"></div>
            </div>
            <div class="llmt-time-actions">
                <button class="llmt-time-btn" id="llmt-btn-cancel">Cancel</button>
                <button class="llmt-time-btn" id="llmt-btn-confirm">Skip Time</button>
            </div>
        </div>
    </div>`;
    $('body').append(h);

    renderSkipChips();

    function updateDisplay() {
        var hVal = $('#llmt-range-h').val();
        var mVal = $('#llmt-range-m').val();
        $('#llmt-lbl-h').text(hVal);
        $('#llmt-lbl-m').text(mVal);
        $('#llmt-disp-h').text(hVal.padStart(2, '0'));
        $('#llmt-disp-m').text(mVal.padStart(2, '0'));
        $('#llmt-hourglass').css('transform', `rotate(${(hVal * 15) + (mVal * 2)}deg)`);
    }

    $('#llmt-range-h, #llmt-range-m').on('input', updateDisplay);

    $('.llmt-skip-tab').on('click', function () {
        setTimeSkipMode($(this).data('mode'));
    });

    $('#llmt-skip-action-text').on('keydown', function (e) {
        e.stopPropagation();
        if (e.ctrlKey && e.key === 'Enter') $('#llmt-btn-confirm').click();
        if (e.key === 'Escape') $('#llmt-time-overlay').fadeOut(200);
    });

    $('#llmt-btn-cancel').on('click', function () { $('#llmt-time-overlay').fadeOut(200); });
    $('#llmt-btn-confirm').on('click', function () {
        if (settings.timeSkipMode === 'action') {
            var act = $('#llmt-skip-action-text').val().trim();
            if (!act) { $('#llmt-skip-action-text').focus(); return; }
            $('#llmt-time-overlay').fadeOut(200);
            $('#llmt-skip-action-text').val('');
            executeActionSkip(act);
        } else {
            var h = $('#llmt-range-h').val();
            var m = $('#llmt-range-m').val();
            $('#llmt-time-overlay').fadeOut(200);
            executeTimeSkip(h, m);
        }
    });
}

/** (Re)build the quick-fill chip row inside the Time Skip dialog. */
function renderSkipChips() {
    var $chips = $('#llmt-skip-chips');
    if (!$chips.length) return;
    $chips.empty();

    var list = Array.isArray(settings.timeSkipChips) ? settings.timeSkipChips : [];
    list.forEach(function (c) {
        $('<div class="llmt-skip-chip"></div>').text(c).on('click', function () {
            $('#llmt-skip-action-text').val(c).focus();
        }).appendTo($chips);
    });
}

/** Switch the Time Skip dialog between clock mode and action mode. */
function setTimeSkipMode(mode) {
    var isAction = (mode === 'action');
    settings.timeSkipMode = isAction ? 'action' : 'clock';
    saveSettings();

    $('.llmt-skip-tab').each(function () {
        $(this).toggleClass('llmt-skip-tab-active', $(this).data('mode') === settings.timeSkipMode);
    });
    $('#llmt-skip-pane-clock').toggle(!isAction);
    $('#llmt-skip-pane-action').toggle(isAction);
    $('#llmt-time-modal').toggleClass('llmt-time-modal-wide', isAction);
    $('#llmt-btn-confirm').html(isAction
        ? '<i class="fa-solid fa-forward"></i> Skip Through'
        : 'Skip Time');
    if (isAction) setTimeout(function () { $('#llmt-skip-action-text').focus(); }, 60);
}

function openTimeSkipDialog() {
    setTimeSkipMode(settings.timeSkipMode || 'clock');
    $('#llmt-time-overlay').css('display', 'flex').hide().fadeIn(200);
}

function executeTimeSkip(h, m) {
    var hNum = parseInt(h) || 0;
    var mNum = parseInt(m) || 0;
    if (hNum === 0 && mNum === 0) return;

    var timeStr = "";
    if (hNum > 0) timeStr += hNum + (hNum === 1 ? " hour " : " hours ");
    if (mNum > 0) timeStr += mNum + " minutes";
    timeStr = timeStr.trim();

    var promptText = `Start your response exactly with this text: "***\n*⏳ Time skips forward by ${timeStr}...*\n***\n\n". Then write a detailed narrative describing what happened during this ${timeStr} time skip. How did the characters spend this time? Bring the story smoothly to the present moment. Write ONLY the narrative, do not speak for the characters.`;
    var $textarea = $('#send_textarea');
    $textarea.val('/sysgen ' + promptText).trigger('input');
    $('#send_but').click();
}

/**
 * Action-based skip: instead of a fixed number of hours/minutes, the user
 * names an activity ("have breakfast") and the LLM both narrates it and decides
 * how much in-story time it consumed.
 */
function executeActionSkip(actionText) {
    var act = String(actionText || '').trim();
    if (!act) return;
    act = act.replace(/"/g, "'");

    var promptText = `The user's character now does the following: "${act}".\n`
        + `First, silently decide how much in-story time this activity realistically takes.\n`
        + `Start your response exactly with this block, where <activity> is a short summary of the activity `
        + `and <duration> is your time estimate (e.g. "25 minutes", "2 hours") — both written in the language of the ongoing roleplay:\n`
        + `"***\n*⏳ <activity> — <duration>...*\n***\n\n"\n`
        + `Then write a detailed narrative describing how this activity unfolds from beginning to end, `
        + `what the other characters do meanwhile, and how the surroundings change. `
        + `Bring the story smoothly to the moment right after the activity is finished. `
        + `Write ONLY the narrative, do not speak for the characters.`;

    var $textarea = $('#send_textarea');
    $textarea.val('/sysgen ' + promptText).trigger('input');
    $('#send_but').click();
}

function addMessageButtons() {
    if (!settings.enabled) return;
    $('.mes').each(function () {
        var $mes   = $(this);
        var mesIdStr = $mes.attr('mesid');
        if (!mesIdStr) return;
        var mesId  = parseInt(mesIdStr, 10);
        if (mesId === 0) return;

        var isUser = $mes.attr('is_user') === 'true';
        var $btnContainer = $mes.find('.mes_buttons');

        if ($btnContainer.length) {
            if (!isUser && !$btnContainer.find('.llm-rethink-btn').length) {
                var $rethinkBtn = $('<div class="mes_button llm-tool-btn llm-rethink-btn" title="Rethink 🧠"><i class="fa-solid fa-brain"></i></div>');
                $rethinkBtn.on('click', function (e) { e.stopPropagation(); startManualRethink(mesId, $mes); });
                $btnContainer.prepend($rethinkBtn);
            }
            if (!$btnContainer.find('.llm-erase-btn').length) {
                var $eraseBtn = $('<div class="mes_button llm-tool-btn llm-erase-btn llm-quick-erase" title="Quick Erase ⚡"><i class="fa-solid fa-bolt"></i></div>');
                $eraseBtn.on('click', async function (e) {
                    e.stopPropagation();
                    if (!confirm("⚡ Delete this and ALL subsequent messages?")) return;
                    if (scriptModule && scriptModule.chat) {
                        scriptModule.chat.splice(mesId);
                        $('.mes').filter(function() { return parseInt($(this).attr('mesid'), 10) >= mesId; }).remove();
                        await safeSaveChat();
                        if (scriptModule.eventSource) scriptModule.eventSource.emit(scriptModule.event_types.MESSAGE_DELETED, mesId);
                    }
                });
                $btnContainer.prepend($eraseBtn);
            }
            if (settings.translateEnabled && !$btnContainer.find('.llm-translate-btn').length) {
                (function(capturedMesId, captured$mes) {
                    var $transBtn = $('<div class="mes_button llm-tool-btn llm-translate-btn" title="Translate (LLM) 🌐"><i class="fa-solid fa-language"></i></div>');
                    $transBtn.on('click', function (e) {
                        e.stopPropagation();
                        llmtToggleTranslation(capturedMesId, captured$mes, $transBtn);
                    });
                    $btnContainer.prepend($transBtn);
                })(mesId, $mes);
            }
        }
    });
}

/* =========================================================
 * LLM TRANSLATION
 * - Translates a message via generateQuietPrompt
 * - Original chat[] is NEVER modified — only DOM changes
 * ========================================================= */

async function llmtToggleTranslation(mesId, $mes, $btn) {
    var state = $mes.data('llmt-trans-state') || 'original';

    if (state === 'translated') {
        // Restore original HTML
        var savedHtml = $mes.data('llmt-original-html');
        if (savedHtml !== undefined) {
            $mes.find('.mes_text').html(savedHtml);
        }
        $mes.data('llmt-trans-state', 'original');
        $btn.removeClass('llm-translate-btn-active').attr('title', 'Translate (LLM) 🌐')
            .html('<i class="fa-solid fa-language"></i>');
        return;
    }

    // Check cache first (same language)
    var cached = llmtTranslationCache[mesId];
    if (cached && cached.lang === settings.translateLang) {
        var $mesText = $mes.find('.mes_text');
        $mes.data('llmt-original-html', $mesText.html());
        $mesText.html(llmtBuildTranslationHtml(cached.text, settings.translateLang));
        $mes.data('llmt-trans-state', 'translated');
        $btn.addClass('llm-translate-btn-active').attr('title', 'Show Original')
            .html('<i class="fa-solid fa-language"></i>');
        return;
    }

    // Fetch source text from chat[] (original, untouched)
    var mesObj = scriptModule && scriptModule.chat && scriptModule.chat[mesId];
    if (!mesObj) return;
    // Strip any hidden prompt spans we may have injected for rethink/auto
    var sourceText = mesObj.mes.replace(/<span class="llm-tools-hidden-prompt">[\s\S]*?<\/span>/g, '').trim();

    // Show loading spinner
    var $mesText2 = $mes.find('.mes_text');
    var originalHtml = $mesText2.html();
    $mes.data('llmt-original-html', originalHtml);
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i>').attr('title', 'Translating…');

    try {
        var translated = await llmtTranslateText(sourceText, settings.translateLang);
        llmtTranslationCache[mesId] = { lang: settings.translateLang, text: translated };
        $mesText2.html(llmtBuildTranslationHtml(translated, settings.translateLang));
        $mes.data('llmt-trans-state', 'translated');
        $btn.addClass('llm-translate-btn-active').attr('title', 'Show Original')
            .html('<i class="fa-solid fa-language"></i>');
    } catch (err) {
        // Revert on error
        $mesText2.html(originalHtml);
        $mes.data('llmt-trans-state', 'original');
        $btn.removeClass('llm-translate-btn-active').attr('title', 'Translation failed — click to retry')
            .html('<i class="fa-solid fa-language"></i>');
        console.error('[LLM Tools] Translation error:', err);
    }
}

function llmtRenderMarkdown(text) {
    // 1) Try SillyTavern's own messageFormatting (chat.js export)
    if (chatModule && typeof chatModule.messageFormatting === 'function') {
        try { return chatModule.messageFormatting(text, '', false, false, -1); } catch (e) {}
    }
    // 2) Try global scope (some ST builds expose it directly)
    if (typeof messageFormatting === 'function') {
        try { return messageFormatting(text, '', false, false, -1); } catch (e) {}
    }
    // 3) Fallback: hand-rolled markdown subset that covers typical ST chat output
    return llmtFallbackMarkdown(text);
}

function llmtFallbackMarkdown(text) {
    // Split on blank lines → paragraphs, then render inline markdown in each
    var paras = text.split(/\n{2,}/);
    var html = '';
    paras.forEach(function(para) {
        para = para.trim();
        if (!para) return;

        // Horizontal rules: --- or ***
        if (/^(-{3,}|\*{3,})$/.test(para)) { html += '<hr>'; return; }

        // Render inline markdown for each line, then join
        var lines = para.split(/\n/).map(function(line) {
            // HTML-escape first
            line = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

            // Bold+italic ***text***
            line = line.replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
            // Bold **text**
            line = line.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
            // Italic *text*  (skip lone asterisks)
            line = line.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
            // ~~strikethrough~~
            line = line.replace(/~~([^~]+?)~~/g, '<s>$1</s>');
            return line;
        });

        var joined = lines.join('<br>');

        // If the whole paragraph was italic (action line), wrap in <em> block
        // e.g.  *He picks up the pencil.*  → already handled per-line above
        html += '<p>' + joined + '</p>';
    });
    return html || '<p>' + $('<span>').text(text).html() + '</p>';
}

function llmtBuildTranslationHtml(text, lang) {
    var rendered = llmtRenderMarkdown(text);
    var safeLang = $('<span>').text(lang).html();
    return '<div class="llmt-trans-result">'
        + '<div class="llmt-trans-badge"><i class="fa-solid fa-language"></i> ' + safeLang + '</div>'
        + '<div class="llmt-trans-body">' + rendered + '</div>'
        + '</div>';
}

async function llmtTranslateText(text, targetLang) {
    // generateRaw sends ONLY the given prompt — no chat history, no context.
    // That's exactly what we want for translation: a clean, isolated call.
    var generateRawFn = (scriptModule && typeof scriptModule.generateRaw === 'function')
        ? scriptModule.generateRaw.bind(scriptModule)
        : (typeof generateRaw === 'function' ? generateRaw : null);

    // generateQuietPrompt is a fallback — it injects the prompt into the full
    // chat context, so the whole dialogue is sent along. Acceptable, but wasteful.
    var generateQuietFn = (scriptModule && typeof scriptModule.generateQuietPrompt === 'function')
        ? scriptModule.generateQuietPrompt.bind(scriptModule)
        : (typeof generateQuietPrompt === 'function' ? generateQuietPrompt : null);

    if (!generateRawFn && !generateQuietFn) throw new Error('No generation function available');

    var systemPrompt = 'You are a professional translator. '
        + 'Translate the text provided by the user into ' + targetLang + '. '
        + 'Output ONLY the translated text — no preamble, no explanations, no commentary. '
        + 'Preserve all formatting exactly: asterisks around actions (*like this*), '
        + 'quotes around dialogue, paragraph breaks, bold (**like this**), and horizontal rules (---).';

    var result;
    if (generateRawFn) {
        // generateRaw(prompt, api, instructOverride, quietToLoud, systemPrompt, maxTokens)
        // Sends only system + user message — zero chat history.
        result = await generateRawFn(text, '', false, false, systemPrompt, 1000);
    } else {
        // Fallback: wrap into an instruction block for generateQuietPrompt
        var fullPrompt = '[INST]' + systemPrompt + '\n\nText to translate:\n' + text + '\n[/INST]';
        result = await generateQuietFn(fullPrompt, false);
    }

    if (!result || typeof result !== 'string') throw new Error('Empty translation result');

    // Strip any accidental wrapping quotes the model may add
    result = result.replace(/^["""«»\s]+|["""«»\s]+$/g, '').trim();
    return result || text;
}

function llmtRestoreAllTranslations() {
    $('.mes[data-llmt-trans-state="translated"]').each(function () {
        var $mes = $(this);
        var savedHtml = $mes.data('llmt-original-html');
        if (savedHtml !== undefined) $mes.find('.mes_text').html(savedHtml);
        $mes.data('llmt-trans-state', 'original').removeData('llmt-original-html');
    });
}

function startManualRethink(mesId, $mesNode) {
    if (!scriptModule || !scriptModule.chat || scriptModule.is_generating) return;
    if (isManualRethink) return;

    var chatArr      = scriptModule.chat;
    var systemPrompt = RETHINK_MODES[settings.rethinkMode].prompt;
    var lastUserIdx  = -1;
    for (var i = mesId - 1; i >= 0; i--) { if (chatArr[i].is_user) { lastUserIdx = i; break; } }

    if (lastUserIdx !== -1) {
        isManualRethink    = true;
        manualRethinkMesId = mesId;
        manualUserIdx      = lastUserIdx;
        manualOriginalText = chatArr[lastUserIdx].mes.replace(/<span class="llm-tools-hidden-prompt">[\s\S]*?<\/span>/g, "").trim();
        chatArr[lastUserIdx].mes = manualOriginalText + `<span class="llm-tools-hidden-prompt">\n\n${systemPrompt}</span>`;
        var $swipeBtn = $mesNode.find('.swipe_right');
        if ($swipeBtn.length) $swipeBtn.click(); else $('#GenerateButton').click();
    }
}

async function finishManualRethink() {
    if (!isManualRethink) return;
    if (manualUserIdx !== -1 && scriptModule.chat[manualUserIdx]) {
        scriptModule.chat[manualUserIdx].mes = manualOriginalText;
    }
    isManualRethink    = false;
    manualRethinkMesId = -1;
    manualUserIdx      = -1;
    await safeSaveChat();
}

function applyAutoRethink() {
    if (!settings.enabled || !settings.autoRethink || !scriptModule || !scriptModule.chat) return;
    var chatArr      = scriptModule.chat;
    if (chatArr.length === 0) return;
    var systemPrompt = RETHINK_MODES[settings.rethinkMode].prompt;
    var targetIdx    = -1;
    for (var i = chatArr.length - 1; i >= 0; i--) { if (chatArr[i].is_user) { targetIdx = i; break; } }
    if (targetIdx >= 0) {
        var cleanedMes = chatArr[targetIdx].mes.replace(/<span class="llm-tools-hidden-prompt">[\s\S]*?<\/span>/g, "").trim();
        autoUserIdx      = targetIdx;
        autoOriginalText = cleanedMes;
        chatArr[autoUserIdx].mes = cleanedMes + `<span class="llm-tools-hidden-prompt">\n\n${systemPrompt}</span>`;
    }
}

async function cleanupAutoRethink() {
    if (autoUserIdx !== -1 && scriptModule && scriptModule.chat[autoUserIdx]) {
        scriptModule.chat[autoUserIdx].mes = autoOriginalText;
        autoUserIdx = -1;
        await safeSaveChat();
    }
}

function restoreGreetingFirstMes() {
    if (greetingRestoreTimer) { clearTimeout(greetingRestoreTimer); greetingRestoreTimer = null; }
    if (greetingPatchedCharId !== null) {
        var chars = (scriptModule && scriptModule.characters) || window.characters || [];
        if (chars[greetingPatchedCharId]) {
            chars[greetingPatchedCharId].first_mes = greetingPatchedOriginalMes;
        }
        greetingPatchedCharId      = null;
        greetingPatchedOriginalMes = null;
    }
}

function scheduleGreetingRestore(delayMs) {
    if (greetingRestoreTimer) clearTimeout(greetingRestoreTimer);
    greetingRestoreTimer = setTimeout(function () {
        greetingRestoreTimer = null;
        restoreGreetingFirstMes();
    }, delayMs || 6000);
}

function getAltGreetings(char) {
    return (char.data && Array.isArray(char.data.alternate_greetings) ? char.data.alternate_greetings : null)
        || (Array.isArray(char.alternate_greetings) ? char.alternate_greetings : null)
        ||[];
}

/* ══════════════════════════════════════════════════════════════
   GREETING PICKER — shared core (v1.7)
   Everything below is used by BOTH the built-in 🎲 button and the
   public API, so a bridged caller gets exactly the same behaviour.
   ══════════════════════════════════════════════════════════════ */

function llmtCharacters() {
    return (scriptModule && scriptModule.characters) || window.characters || [];
}

/* Accepts { charId } or { avatar } or { name } — returns { charId, char } or null. */
function resolveCharTarget(target) {
    target = target || {};
    var chars = llmtCharacters();

    var id = target.charId;
    if (id === undefined || id === null || id === '') id = target.chid;
    if (id !== undefined && id !== null && id !== '') {
        id = parseInt(id, 10);
        if (!isNaN(id) && chars[id]) return { charId: id, char: chars[id] };
    }

    if (target.avatar) {
        for (var i = 0; i < chars.length; i++) {
            if (chars[i] && chars[i].avatar === target.avatar) return { charId: i, char: chars[i] };
        }
    }
    if (target.name) {
        for (var j = 0; j < chars.length; j++) {
            if (chars[j] && chars[j].name === target.name) return { charId: j, char: chars[j] };
        }
    }
    return null;
}

/* Index 0 = the card's own first_mes; 1..n = alternate_greetings[idx - 1]. */
function greetingList(char) {
    var out = [{ idx: 0, text: char.first_mes || '', isDefault: true }];
    var alts = getAltGreetings(char);
    for (var i = 0; i < alts.length; i++) {
        out.push({ idx: i + 1, text: alts[i] || '', isDefault: false });
    }
    return out;
}

function greetingPreview(text, char, limit) {
    limit = limit || 160;
    var clean = String(text || '')
        .replace(/\{\{char\}\}/gi, (char && char.name) || 'char')
        .replace(/\{\{user\}\}/gi, 'User')
        .replace(/<[^>]+>/g, '')
        .replace(/\*\*/g, '').replace(/\*/g, '')
        .trim();
    var cut = clean.substring(0, limit);
    if (clean.length > limit) cut += '…';
    return cut;
}

/* The one and only place that swaps first_mes and opens the chat.
   The swap lives in memory only — the card on disk is never touched.
   It is rolled back by CHAT_CHANGED (see bindEvents) with a timer as a
   safety net, so a failed/cancelled open can never leave the card dirty. */
function startOnGreeting(charId, char, text, opts) {
    opts = opts || {};
    var patch = (text !== null && text !== undefined) && text !== char.first_mes;

    if (patch) {
        greetingPatchedCharId      = charId;
        greetingPatchedOriginalMes = char.first_mes;
        char.first_mes             = text;
        scheduleGreetingRestore(opts.restoreMs || 6000);
    }
    /* ── "new chat" needs a NAME, not an empty string ──
       Blanking char.chat looks like "make a fresh chat", and SillyTavern does
       load an empty one — but every save then dies on the way to disk:
       getChatResult() pushes the greeting and calls saveChatConditional(), and
       saveChat() bails at `if (!fileName) return;` because the file name IS
       characters[this_chid].chat, i.e. ''. The chat exists only in memory, so
       closing it loses the story — and so does every later save, including the
       chat metadata other extensions write (Character Library's story hooks
       were reported exactly this way: "start a hook, close the chat, the story
       is gone").
       ST's own doNewChat() names the file before loading it; do the same. */
    if (opts.newChat !== false) {
        var stCtx = null;
        try { stCtx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null; } catch (e) { }
        var stamp = '';
        try { if (stCtx && typeof stCtx.humanizedDateTime === 'function') stamp = stCtx.humanizedDateTime(); } catch (e) { }
        if (!stamp) {
            /* same shape ST uses, so its chat list sorts and parses it */
            var d = new Date();
            function p2(n) { return (n < 10 ? '0' : '') + n; }
            stamp = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
                + '@' + p2(d.getHours()) + 'h' + p2(d.getMinutes()) + 'm' + p2(d.getSeconds()) + 's';
        }
        char.chat = (char.name || 'Chat') + ' - ' + stamp;
    }
    openCharacterById(charId, opts.fallbackEl || null);
}

/* ── Public API implementations ── */

function apiGetGreetings(target) {
    var t = resolveCharTarget(target);
    if (!t) return [];
    return greetingList(t.char).map(function (g) {
        return {
            idx: g.idx,
            text: g.text,
            isDefault: g.isDefault,
            preview: greetingPreview(g.text, t.char),
        };
    });
}

/* Opens the modal. Resolves with { idx, text } or null if cancelled.
   startChat !== false → also opens the chat on the chosen greeting. */
function apiOpenGreetingPicker(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
        var t = resolveCharTarget(opts);
        if (!t) { resolve(null); return; }
        if (!getAltGreetings(t.char).length) {
            if (typeof toastr !== 'undefined') toastr.info('This character has no alternate greetings.', 'LLM Tools');
            resolve(null);
            return;
        }
        openGreetingPickerPreOpen(t.charId, t.char, opts.cancelLabel || 'Cancel',
            function (text, idx) {
                if (opts.startChat !== false) {
                    startOnGreeting(t.charId, t.char, text, { newChat: opts.newChat });
                }
                resolve({ idx: idx, text: text });
            },
            function () { resolve(null); }
        );
    });
}

/* No modal — straight to a chat opened on greeting #idx. */
function apiStartChatWithGreeting(opts) {
    opts = opts || {};
    var t = resolveCharTarget(opts);
    if (!t) return null;

    var list = greetingList(t.char);
    var idx = parseInt(opts.idx, 10);
    if (isNaN(idx) || idx < 0 || idx >= list.length) idx = 0;

    var text = list[idx].text;
    startOnGreeting(t.charId, t.char, idx === 0 ? null : text, { newChat: opts.newChat });
    return { idx: idx, text: text };
}

function buildGreetingPickerUI() {
    var h = `
    <div id="llmt-greet-overlay">
        <div id="llmt-greet-modal">
            <div class="llmt-modal-header">
                <i class="fa-solid fa-comments" style="color:#4ade80"></i>
                <span>Choose Opening Greeting</span>
                <span class="llmt-modal-close" id="llmt-greet-close">✕</span>
            </div>
            <div class="llmt-modal-hint" id="llmt-greet-hint">
                This character has multiple greetings. Pick one to start with, or let fate decide.
            </div>
            <div id="llmt-greet-list"></div>
            <div class="llmt-modal-actions" style="margin-top:4px">
                <button class="llmt-time-btn" id="llmt-greet-random">
                    <i class="fa-solid fa-dice"></i> Random
                </button>
                <button class="llmt-time-btn" id="llmt-greet-cancel">Use Default</button>
            </div>
        </div>
    </div>`;
    $('body').append(h);
}

function openGreetingPickerPreOpen(charId, char, cancelLabel, onSelect, onCancel) {
    var altGreetings = getAltGreetings(char);
    if (!altGreetings.length) { onCancel && onCancel(); return; }

    var defaultMes  = char.first_mes || '';
    var allGreetings = [defaultMes].concat(altGreetings);

    var $list = $('#llmt-greet-list').empty();
    allGreetings.forEach(function (text, idx) {
        var badgeLabel = idx === 0 ? '⭐ Default' : ('Alt ' + idx);
        var safeText   = text || '';
        var preview    = greetingPreview(safeText, char, 160);

        var $badge   = $('<span class="llmt-greet-badge"></span>').text(badgeLabel);
        var $preview = $('<div class="llmt-greet-preview"></div>').text(preview);
        var $item    = $('<div class="llmt-greet-item"></div>').attr('data-idx', idx).append($badge).append($preview);

        $item.on('click', function () {
            $('#llmt-greet-overlay').fadeOut(200);
            onSelect(safeText, idx);   /* v1.7: index is handed to the caller too */
        });
        $list.append($item);
    });

    $('#llmt-greet-hint').text(allGreetings.length + ' greetings for ' + (char.name || 'this character') + '. Click one to use it.');

    $('#llmt-greet-random').off('click').on('click', function () {
        var $items = $('#llmt-greet-list .llmt-greet-item');
        if (!$items.length) return;
        var idx = Math.floor(Math.random() * $items.length);
        $items.eq(idx).trigger('click');
    });
    $('#llmt-greet-cancel').text(cancelLabel || 'Cancel');
    $('#llmt-greet-close, #llmt-greet-cancel').off('click').on('click', function () {
        $('#llmt-greet-overlay').fadeOut(200);
        onCancel && onCancel();
    });
    $('#llmt-greet-overlay').off('click.backdrop').on('click.backdrop', function (e) {
        if ($(e.target).is('#llmt-greet-overlay')) { $(this).fadeOut(200); onCancel && onCancel(); }
    });

    $('#llmt-greet-overlay').css('display', 'flex').hide().fadeIn(200);
}

function setupGreetingInterceptors() {
    document.addEventListener('click', function (e) {
        if (!settings.greetingPickerEnabled) return;
        if (greetingPickerBypassFlag) { greetingPickerBypassFlag = false; return; }

        var el = e.target.closest('#new_chat, #option_start_new_chat');
        if (!el) return;

        var charId = (scriptModule && scriptModule.this_chid !== undefined)
            ? scriptModule.this_chid
            : (window.this_chid !== undefined ? window.this_chid : null);
        if (charId === null || charId === undefined || charId === -1) return;

        var chars = (scriptModule && scriptModule.characters) || window.characters || [];
        var char  = chars[charId];
        if (!char || !getAltGreetings(char).length) return;

        e.preventDefault();
        e.stopPropagation();

        openGreetingPickerPreOpen(charId, char, 'Use Default',
            function (selected) {
                if (selected !== char.first_mes) {
                    greetingPatchedCharId      = charId;
                    greetingPatchedOriginalMes = char.first_mes;
                    char.first_mes             = selected;
                    scheduleGreetingRestore(6000);
                }
                greetingPickerBypassFlag   = true;
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            },
            function () {
                greetingPickerBypassFlag = true;
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
        );
    }, true);

    setTimeout(injectGreetingButtons, 800);
    setupCharListObserver();
}

function injectGreetingButtons() {
    if (!settings.greetingPickerEnabled) return;
    var chars = (scriptModule && scriptModule.characters) || window.characters ||[];
    if (!chars.length) return;

    $('.character_select').each(function () {
        var $item = $(this);
        if ($item.find('.llmt-greet-btn').length) return; 

        var chidStr = $item.attr('data-chid') || $item.attr('chid');
        var charId  = parseInt(chidStr, 10);
        if (isNaN(charId)) return;

        var char = chars[charId];
        if (!char || !getAltGreetings(char).length) return;

        var $btn = $('<div class="llmt-greet-btn" title="Choose opening greeting 🎲"><i class="fa-solid fa-dice"></i></div>');

        $btn.on('click', function (e) {
            e.stopPropagation();
            e.preventDefault();

            var currentChar = chars[charId];
            openGreetingPickerPreOpen(charId, currentChar, 'Cancel',
                function (selected) {
                    startOnGreeting(charId, currentChar, selected, { fallbackEl: $item[0] });
                },
                null
            );
        });

        $item.append($btn);
    });
}

function openCharacterById(charId, fallbackEl) {
    var fn = (scriptModule && typeof scriptModule.selectCharacterById === 'function')
        ? scriptModule.selectCharacterById.bind(scriptModule)
        : (typeof window.selectCharacterById === 'function' ? window.selectCharacterById : null);

    if (fn) {
        fn(charId);
    } else if (fallbackEl) {
        fallbackEl.click();
    }
}

function setupCharListObserver() {
    var listSelectors =['#rm_print_characters_block', '#character_list', '.character_list'];
    var target = null;
    for (var i = 0; i < listSelectors.length; i++) {
        target = document.querySelector(listSelectors[i]);
        if (target) break;
    }

    var debouncedInject = (function () {
        var t;
        return function () { clearTimeout(t); t = setTimeout(injectGreetingButtons, 250); };
    })();

    if (target) {
        new MutationObserver(debouncedInject).observe(target, { childList: true, subtree: true });
    } else {
        var bodyObs = new MutationObserver(function () {
            for (var i = 0; i < listSelectors.length; i++) {
                var el = document.querySelector(listSelectors[i]);
                if (el) { bodyObs.disconnect(); setupCharListObserver(); return; }
            }
            debouncedInject();
        });
        bodyObs.observe(document.body, { childList: true, subtree: false });
    }
}

// ============================================================
// DYNAMIC CAPTION PROMPT
// ============================================================

var dynCaptionPending = false; // guard against double-triggers

function buildDynCaptionUI() {
    var h = `
    <div id="llmt-dyncap-toast">
        <div id="llmt-dyncap-toast-inner">
            <div class="llmt-dyncap-toast-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
            <div class="llmt-dyncap-toast-body">
                <div class="llmt-dyncap-toast-title">Update Caption Prompt?</div>
                <div class="llmt-dyncap-toast-sub" id="llmt-dyncap-toast-sub">Generating context-aware prompt for <b id="llmt-dyncap-char-name">this character</b>…</div>
            </div>
            <div class="llmt-dyncap-toast-actions">
                <button class="llmt-dyncap-btn llmt-dyncap-btn-yes" id="llmt-dyncap-yes">
                    <i class="fa-solid fa-check"></i> Update
                </button>
                <button class="llmt-dyncap-btn llmt-dyncap-btn-no" id="llmt-dyncap-no">
                    Skip
                </button>
            </div>
            <div class="llmt-dyncap-spinner" id="llmt-dyncap-spinner">
                <i class="fa-solid fa-spinner fa-spin"></i>
            </div>
        </div>
    </div>`;
    $('body').append(h);

    $('#llmt-dyncap-no').on('click', function () {
        hideDynCaptionToast();
    });

    $('#llmt-dyncap-yes').on('click', async function () {
        await runDynCaptionGenerate();
    });
}

function showDynCaptionToast(charName) {
    var name = charName || 'this character';
    $('#llmt-dyncap-char-name').text(name);
    $('#llmt-dyncap-toast-sub').html('Generate a caption prompt based on what <b>' + name + '</b> expects to see?');
    $('#llmt-dyncap-spinner').hide();
    $('#llmt-dyncap-yes, #llmt-dyncap-no').prop('disabled', false).css('opacity', 1);
    $('#llmt-dyncap-toast').addClass('llmt-dyncap-visible');
}

function hideDynCaptionToast() {
    $('#llmt-dyncap-toast').removeClass('llmt-dyncap-visible');
    dynCaptionPending = false;
}

function showDynCaptionStatus(msg, isError) {
    $('#llmt-dyncap-toast-sub').html(msg);
    if (isError) {
        setTimeout(hideDynCaptionToast, 2500);
    }
}

// Gather char info for the LLM meta-prompt
function getDynCaptionContext() {
    var chars = (scriptModule && scriptModule.characters) || window.characters || [];
    var chid  = scriptModule
        ? (scriptModule.this_chid !== undefined ? scriptModule.this_chid : scriptModule.characterId)
        : window.this_chid;

    var char = (chid !== undefined && chid !== null) ? chars[chid] : null;

    // Fallback: grab name from last AI message in DOM
    if (!char) {
        var domName = $('#chat .mes[is_user="false"]').last().find('.name_text').text().trim();
        if (domName) return { name: domName, description: '', personality: '', scenario: '', recentChat: '' };
        return null;
    }

    var ctx = {
        name:        (char.name        || '').trim(),
        description: (char.description || '').substring(0, 800),
        personality: (char.personality || '').substring(0, 400),
        scenario:    (char.scenario    || '').substring(0, 400),
        recentChat:  ''
    };

    // Last 6 messages for context
    var chat = scriptModule && scriptModule.chat;
    if (chat && chat.length) {
        var slice = chat.slice(-6);
        ctx.recentChat = slice.map(function (m) {
            var speaker = m.is_user ? 'User' : ctx.name;
            return speaker + ': ' + (m.mes || '').substring(0, 250);
        }).join('\n');
    }

    return ctx;
}

// Call Claude API to generate caption prompt
// Generate caption prompt via ST's built-in generateQuietPrompt (avoids CORS)
async function generateDynCaptionPrompt(ctx) {
    var generateFn = (scriptModule && typeof scriptModule.generateQuietPrompt === 'function')
        ? scriptModule.generateQuietPrompt.bind(scriptModule)
        : (typeof generateQuietPrompt === 'function' ? generateQuietPrompt : null);

    if (!generateFn) throw new Error('generateQuietPrompt not available — check ST version');

    var parts = [];
    if (ctx.description) parts.push('Character description: ' + ctx.description);
    if (ctx.personality)  parts.push('Personality: ' + ctx.personality);
    if (ctx.scenario)     parts.push('Scenario: ' + ctx.scenario);
    if (ctx.recentChat)   parts.push('Recent conversation:\n' + ctx.recentChat);

    var metaPrompt =
        '[INST]You are configuring an AI image captioning system for a roleplay chat.\n\n' +
        'Character name: ' + ctx.name + '\n' +
        parts.join('\n') + '\n\n' +
        'Task: Write a SHORT image captioning instruction (2-4 sentences max) that tells a vision AI ' +
        'what to focus on and how to describe images that the user sends to this character.\n' +
        'The instruction should reflect:\n' +
        '- What this character would care about in an image (their expertise, role, personality)\n' +
        '- The current roleplay context and what kind of images are likely to be sent\n' +
        '- Specific visual elements, structures, or details this character would notice first\n\n' +
        'Rules: output ONLY the instruction text — no quotes, no preamble, no meta-commentary, no numbered lists. ' +
        'Plain prose, 2-4 sentences max.[/INST]';

    var result = await generateFn(metaPrompt, false);
    if (!result || typeof result !== 'string') throw new Error('Empty response from LLM');

    // Strip any accidental wrapping artifacts
    result = result.replace(/^["'«»\s]+|["'«»\s]+$/g, '').trim();
    return result;
}

// Inject the generated prompt into the Image Captioning extension
function setCaptionExtensionPrompt(prompt) {
    var hits = 0;

    // --- Strategy 1: find textarea by placeholder "< Use default >" ---
    // This is the most reliable — the Caption Prompt field always has this placeholder
    var $byPlaceholder = $('textarea').filter(function () {
        var ph = ($(this).attr('placeholder') || '').toLowerCase();
        return ph.includes('use default') || ph.includes('default');
    });
    if ($byPlaceholder.length) {
        $byPlaceholder.first().val(prompt).trigger('input').trigger('change');
        hits++;
        console.log('[LLM Tools] DynCaption: set via placeholder selector');
    }

    // --- Strategy 2: find textarea near a "Caption Prompt" label ---
    if (!hits) {
        $('label, span, div, p, h4').each(function () {
            var text = $(this).clone().children().remove().end().text().trim();
            if (text !== 'Caption Prompt' && !text.startsWith('Caption Prompt')) return;
            // Walk forward through siblings to find a textarea
            var $ta = $();
            var $next = $(this).next();
            for (var i = 0; i < 5 && $next.length; i++) {
                if ($next.is('textarea')) { $ta = $next; break; }
                var $inner = $next.find('textarea');
                if ($inner.length) { $ta = $inner.first(); break; }
                $next = $next.next();
            }
            // Also check inside a shared parent
            if (!$ta.length) {
                $ta = $(this).closest('div, section').find('textarea').first();
            }
            if ($ta.length) {
                $ta.val(prompt).trigger('input').trigger('change');
                hits++;
                console.log('[LLM Tools] DynCaption: set via label proximity');
                return false; // break $.each
            }
        });
    }

    // --- Strategy 3: direct ID guesses ---
    if (!hits) {
        var ids = [
            '#caption_prompt', '#caption_prompt_text', '#caption_prompt_textarea',
            '#caption_user_prompt', '#image_caption_prompt'
        ];
        for (var i = 0; i < ids.length; i++) {
            var $el = $(ids[i]);
            if ($el.length) {
                $el.val(prompt).trigger('input').trigger('change');
                hits++;
                console.log('[LLM Tools] DynCaption: set via ID ' + ids[i]);
                break;
            }
        }
    }

    // --- Strategy 4: update extension_settings object (all plausible keys) ---
    var extSettings = (typeof extension_settings !== 'undefined')
        ? extension_settings
        : (extsModule && extsModule.extension_settings) || null;
    if (extSettings) {
        var captionKeys = ['caption', 'image_caption', 'imagecaption', 'Caption', 'ImageCaption'];
        for (var j = 0; j < captionKeys.length; j++) {
            var k = captionKeys[j];
            if (extSettings[k] !== undefined) {
                // Cover all sub-key variants seen in different ST versions
                extSettings[k].prompt         = prompt;
                extSettings[k].caption_prompt = prompt;
                extSettings[k].captionPrompt  = prompt;
                hits++;
                console.log('[LLM Tools] DynCaption: set via extension_settings.' + k);
                break;
            }
        }
    }

    if (!hits) {
        console.warn('[LLM Tools] DynCaption: could not find Caption Prompt textarea — prompt generated but not injected.');
    }

    saveSettings();
    return hits > 0;
}

// Full orchestration: generate + inject
async function runDynCaptionGenerate() {
    var ctx = getDynCaptionContext();
    if (!ctx) {
        showDynCaptionStatus('❌ No character found.', true);
        return;
    }

    $('#llmt-dyncap-yes, #llmt-dyncap-no').prop('disabled', true).css('opacity', 0.45);
    $('#llmt-dyncap-spinner').show();
    showDynCaptionStatus('✨ Generating prompt for <b>' + ctx.name + '</b>…');

    try {
        var prompt = await generateDynCaptionPrompt(ctx);
        var injected = setCaptionExtensionPrompt(prompt);
        $('#llmt-dyncap-spinner').hide();
        showDynCaptionStatus('✅ Caption prompt updated!');
        setTimeout(hideDynCaptionToast, 2000);
        console.log('[LLM Tools] Dynamic caption prompt set:', prompt);
        if (!injected) {
            console.warn('[LLM Tools] Caption DOM textarea not found — settings updated but UI may need manual refresh.');
        }
    } catch (err) {
        $('#llmt-dyncap-spinner').hide();
        console.error('[LLM Tools] Dynamic caption error:', err);
        showDynCaptionStatus('❌ Error: ' + (err.message || err), true);
    }
}

// Detect image attachment and trigger the flow
function setupDynCaptionHook() {
    // Strategy 1: watch any file input change in the document
    $(document).on('change.llmt-dyncap', 'input[type="file"]', function () {
        if (!settings.dynCaptionEnabled) return;
        var files = this.files;
        if (!files || !files.length) return;
        var hasImage = Array.from(files).some(function (f) { return f.type.startsWith('image/'); });
        if (!hasImage) return;
        triggerDynCaption();
    });

    // Strategy 2: MutationObserver watching the send form for an image preview appearing
    var formSelectors = ['#send_form', '#sheld', '#form_sheld', '#rightSendForm'];
    var $form = null;
    for (var i = 0; i < formSelectors.length; i++) {
        if ($(formSelectors[i]).length) { $form = $(formSelectors[i]); break; }
    }
    if (!$form || !$form.length) $form = $('body');

    var dynCapObserver = new MutationObserver(function (mutations) {
        if (!settings.dynCaptionEnabled || dynCaptionPending) return;
        for (var i = 0; i < mutations.length; i++) {
            var added = mutations[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
                var node = added[j];
                if (!node.nodeType || node.nodeType !== 1) continue;
                // Look for image preview thumbnails that ST injects
                var isImgPreview = (
                    (node.id && (node.id.includes('img') || node.id.includes('image') || node.id.includes('preview'))) ||
                    (node.className && typeof node.className === 'string' && (
                        node.className.includes('img') || node.className.includes('image') || node.className.includes('preview')
                    )) ||
                    $(node).find('img').length > 0
                );
                if (isImgPreview) {
                    triggerDynCaption();
                    return;
                }
            }
        }
    });
    dynCapObserver.observe($form[0], { childList: true, subtree: true });
}

// Entry point called when an image attachment is detected
function triggerDynCaption() {
    if (!settings.dynCaptionEnabled) return;
    if (dynCaptionPending) return; // already waiting
    dynCaptionPending = true;

    var ctx = getDynCaptionContext();
    var charName = ctx ? ctx.name : '';

    if (settings.dynCaptionConfirm) {
        // Show the confirmation toast — let user decide
        showDynCaptionToast(charName);
    } else {
        // Silent mode — just run immediately
        showDynCaptionToast(charName);
        runDynCaptionGenerate();
    }
}

function bindEvents() {
    if (!scriptModule || !scriptModule.eventSource) return;
    var es = scriptModule.eventSource;
    var et = scriptModule.event_types;

    es.on(et.CHAT_CHANGED, function () {
        autoUserIdx = -1;
        autoOriginalText = "";
        llmtTranslationCache = {};
        restoreGreetingFirstMes();
        setTimeout(addMessageButtons, 500);
        setTimeout(injectGreetingButtons, 600);
        
        // VN Mode reset on chat change
        vnCurrentChunkIndex = 0;
        vnLastEmittedKey = ''; vnLastSeenTotalChunks = 0;
        if (settings.visualNovelMode) {
            applyVisualNovelMode();
        }
    });
    
    es.on(et.MESSAGE_RENDERED, function () { 
        if (settings.enabled) addMessageButtons(); 
        if (settings.visualNovelMode) updateVnView();
    });
    
    es.on(et.CHARACTER_MESSAGE_RENDERED, function () { 
        if (settings.enabled) addMessageButtons(); 
        if (settings.visualNovelMode) updateVnView({ force: true });
    });

    // Re-render VN view as content streams in. Different ST builds expose
    // different streaming events — listen to whichever exist.
    var streamEvents = [
        et.STREAM_TOKEN_RECEIVED,
        et.SMART_CONTEXT,
        et.STREAM_END,
        et.GENERATION_AFTER_COMMANDS
    ];
    streamEvents.forEach(function(ev) {
        if (ev) {
            es.on(ev, function() {
                if (settings.visualNovelMode) updateVnView();
            });
        }
    });

    if (et.MESSAGE_EDITED) {
        es.on(et.MESSAGE_EDITED, function() {
            // No force: editing a message should refresh the VN view but
            // must NOT trigger downstream TTS playback on the edited chunk.
            if (settings.visualNovelMode) updateVnView();
        });
    }

    if (et.MESSAGE_SWIPED) {
        es.on(et.MESSAGE_SWIPED, function() {
            vnCurrentChunkIndex = 0;
            vnLastEmittedKey = ''; vnLastSeenTotalChunks = 0;
            if (settings.visualNovelMode) updateVnView({ force: true });
        });
    }

    if (et.MESSAGE_DELETED) {
        es.on(et.MESSAGE_DELETED, function() {
            vnCurrentChunkIndex = 0;
            vnLastEmittedKey = ''; vnLastSeenTotalChunks = 0;
            if (settings.visualNovelMode) updateVnView({ force: true });
        });
    }

    var autoEvent = et.USER_MESSAGE_RENDERED || et.MESSAGE_SENT;
    if (autoEvent) {
        es.on(autoEvent, function () {
            if (!settings.enabled || !settings.autoRethink || isManualRethink) return;
            applyAutoRethink();
        });
    }

    // --- Trim unread fragments when the user sends a reply ---
    // In VN mode, only the chunks the user actually read should be sent to the
    // LLM as context — otherwise the LLM "knows" things the user never saw,
    // which breaks the whole pacing illusion. We rewrite the stored
    // aiMes.mes to contain only the read portion, then re-render the DOM
    // so what's on screen matches what's in chat[].
    if (et.MESSAGE_SENT) {
        es.on(et.MESSAGE_SENT, function() {
            if (!settings.visualNovelMode) return;
            try {
                trimUnreadVnFragments();
            } catch (e) {
                console.error('[LLM Tools] VN trim failed:', e);
            }
            vnCurrentChunkIndex = 0;
            vnLastEmittedKey = '';
            vnLastSeenTotalChunks = 0;
            // NOTE: plain updateVnView() without force. We must NOT emit
            // llmt:vn-chunk-advance here: at this point the LLM has not yet
            // produced anything, so any emit would point AutoVoice at the
            // chunk the user just trimmed off the previous AI message —
            // which is exactly the paragraph they already read. AutoVoice
            // would then start voicing it on GPU between Send and the LLM
            // response, then cut it off when the new message arrives.
            // The right emit will come from CHARACTER_MESSAGE_RENDERED
            // once the new AI message is fully streamed.
            updateVnView();
        });
    }

    if (et.GENERATION_STARTED) {
        es.on(et.GENERATION_STARTED, function (type) {
            if (!settings.enabled) return;
            // Quiet/impersonate/sysgen generations (used by AutoIllustrator,
            // translate, summarize, etc.) must NOT reset the user's VN reading
            // position.
            if (!type || type === 'quiet' || type === 'impersonate' || type === 'sysgen') return;
            vnCurrentChunkIndex = 0;
            vnLastEmittedKey = ''; vnLastSeenTotalChunks = 0;
            if (!autoEvent && settings.autoRethink && !isManualRethink) applyAutoRethink();
        });
    }

    if (et.GENERATION_STOPPED) {
        es.on(et.GENERATION_STOPPED, async function () {
            await cleanupAutoRethink();
            if (isManualRethink) await finishManualRethink();
            if (settings.visualNovelMode) updateVnView();
        });
    }

    setTimeout(function () { 
        if (settings.enabled) addMessageButtons(); 
        if (settings.visualNovelMode) applyVisualNovelMode(); 
    }, 1000);
}