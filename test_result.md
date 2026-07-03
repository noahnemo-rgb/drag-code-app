#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Build a mobile app to code within a GUI. Currently implementing the "Push Code" feature
  which exports the current file via GitHub REST API (PAT), custom HTTPS webhook, or the
  native OS Share sheet. Needs functional verification.

frontend:
  - task: "Push Modal – opens from header icon and command palette"
    implemented: true
    working: "NA"
    file: "app/frontend/app/index.tsx, app/frontend/src/components/PushModal.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Header upload icon and Command Palette entry 'Push code…' both wired to setShowPush(true). Modal has testID 'push-modal'."

  - task: "Push Modal – tab switching (GitHub / Webhook / Share)"
    implemented: true
    working: "NA"
    file: "app/frontend/src/components/PushModal.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Three tabs with testIDs push-tab-github, push-tab-webhook, push-tab-share. Verify active-state styling changes."

  - task: "GitHub push – form validation and error handling"
    implemented: true
    working: "NA"
    file: "app/frontend/src/lib/push.ts, app/frontend/src/components/PushModal.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Empty PAT / missing owner|repo|branch|path must surface inline error via push-status. With a dummy PAT the GitHub API will 401 – the error message must be shown and must redact the token."

  - task: "GitHub PAT – secure storage (web fallback to AsyncStorage)"
    implemented: true
    working: "NA"
    file: "app/frontend/src/lib/push.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "On web, expo-secure-store is not available – code falls back to AsyncStorage. After saving a PAT and reopening the modal, the field should be prefilled and label switches to 'GitHub PAT (saved on device)'. 'Clear stored token' must wipe it."

  - task: "Webhook push – https-only guard and POST"
    implemented: true
    working: "NA"
    file: "app/frontend/src/lib/push.ts, app/frontend/src/components/PushModal.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "http:// URL must throw 'Webhook URL must use https://'. Real POST to a public test endpoint (e.g. https://httpbin.org/post) should return 200 and show 'Webhook accepted (HTTP 200).'"

  - task: "Native Share – opens OS share sheet or web fallback"
    implemented: true
    working: "NA"
    file: "app/frontend/src/lib/push.ts"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "On web, expo-sharing.isAvailableAsync() returns false so it falls back to React Native Share.share. Verify tapping 'Open Share sheet' doesn't crash and either opens a share UI or reports a benign message."

  - task: "Push regression – existing shortcuts (⌘F, ⌘P, ⇧⌘P, ⌘Enter, ⌘S, Esc) still work"
    implemented: true
    working: "NA"
    file: "app/frontend/app/index.tsx, app/frontend/src/hooks/use-editor-shortcuts.ts"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Regression check – Esc must close Push modal (existing effect on line 523). Command Palette (⇧⌘P) still contains 'Push code…' entry."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 5
  run_ui: true

test_plan:
  current_focus:
    - "Push Modal – opens from header icon and command palette"
    - "Push Modal – tab switching (GitHub / Webhook / Share)"
    - "GitHub push – form validation and error handling"
    - "GitHub PAT – secure storage (web fallback to AsyncStorage)"
    - "Webhook push – https-only guard and POST"
    - "Native Share – opens OS share sheet or web fallback"
    - "Push regression – existing shortcuts (⌘F, ⌘P, ⇧⌘P, ⌘Enter, ⌘S, Esc) still work"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: |
        Please test the newly-added "Push Code" feature end-to-end on the web preview at http://localhost:3000.

        Trigger points:
          1. Header icon: the upload / arrow-up icon in the top bar (right of the filename, next to the box/package icon).
          2. Command Palette: press ⇧⌘P (or long-press the filename) and select "Push code…".

        Verify:
          - Modal opens with testID 'push-modal' and three tabs (push-tab-github, push-tab-webhook, push-tab-share).
          - GitHub tab: submitting with empty PAT / empty owner|repo|branch|path shows an inline validation message.
            Then enter dummy values (pat=ghp_dummy, owner=octocat, repo=hello-world, branch=main, path=test.py) and tap 'Push to GitHub'. Expect a 401 error surfaced in push-status – token must be redacted (not visible in full).
          - Reopen the modal and confirm PAT field label reads 'GitHub PAT (saved on device)' and the token is prefilled.
          - Tap 'Clear stored token'. Reopen – field should be empty and label back to 'GitHub PAT'.
          - Webhook tab: entering 'http://example.com' and tapping POST shows 'Webhook URL must use https://'. Entering 'https://httpbin.org/post' should return 200 and show 'Webhook accepted (HTTP 200).'
          - Share tab: tapping 'Open Share sheet' on web should not crash (web fallback path).
          - Esc key closes the modal.

        No backend testing needed – all push logic is client-side.

        Test credentials: none required (all tokens are dummy / user-supplied at runtime).
    - agent: "testing"
      message: |
        Iteration 6: 10/13 requirements PASS. 3 gaps reported —
          1. HIGH: Long-press on filename did not open Command Palette (touch-only users blocked).
          2. MEDIUM env: Webhook POST to httpbin.org fails on web due to CORS (env limitation, not a bug).
          3. MEDIUM: Share tab on web showed 'Share is not supported'; suggested clipboard fallback.
    - agent: "main"
      message: |
        Applied two fixes:
          (1) Added onLongPress + delayLongPress={350} to the filename Pressable so touch users can open the Command Palette by long-pressing the filename.
          (2) Rewrote shareViaNative() to try navigator.share() first, then fall back to navigator.clipboard.writeText() on web. Return type is now a discriminated union { kind: 'share' | 'clipboard' | 'cancelled' } so PushModal shows a green success message on the clipboard path instead of a red error.
        Webhook CORS on httpbin is an environment limitation, no code change.
    - agent: "testing"
      message: |
        Iteration 7: Both fixes VERIFIED.
          - Long-press on filename-lang-picker opens command-palette-modal; 'command-push' entry opens push-modal.
          - Share tab on web now shows the green clipboard fallback message ('Copied hello.py to clipboard — the Web Share API is unavailable in this browser.') and actually calls navigator.clipboard.writeText with the file content.
        No new issues. retest_needed=false.
    - agent: "main"
      message: |
        Iteration 8 (palette polish): Two new palette enhancements added.
          (A) RECENT badge on MRU-boosted rows in the Command Palette AND on file rows in the Quick File Switcher — capped to top 5 by new isRecent() helper in src/lib/mru.ts.
          (B) Quick File Switcher results are now grouped by kind (Files → In-file matches → Snippets) with non-interactive section headers.
    - agent: "testing"
      message: |
        Iteration 8: 8/8 checks PASSED. Empty MRU → 0 badges. Top-5 cap validated. Section headers render in the correct order and keyboard nav skips them naturally. Snippet section code path reviewed but not exercised live (no matching snippet in the default project — future improvement). retest_needed=false.
    - agent: "main"
      message: |
        Iteration 9 (Phase-1 refactor): Extracted 6 files from app/index.tsx (2329 → 1889 lines).
          - src/lib/language.ts (LANGS, EXT_TO_LANG, inferLang, starterFor)
          - src/components/HighlightedText.tsx
          - src/components/Sheet.tsx (reusable Modal+backdrop+card wrapper)
          - src/components/PromptModal.tsx (uses Sheet)
          - src/components/CommandPaletteModal.tsx (~194 lines, self-contained styles)
          - src/components/QuickFileSwitcherModal.tsx (~262 lines, self-contained styles)
        Pure structural change — all testIDs preserved, no UI/UX changes.
    - agent: "testing"
      message: |
        Iteration 9: 13/13 regression checks PASSED. All prior features from iterations 6-8 still work (palettes, RECENT badges, section headers, keyboard nav, Push tabs, long-press filename, Escape close, PromptModal, New File flow). No prop-wiring bugs. Two pre-existing RN-Web deprecation warnings (shadow*, pointerEvents) unrelated to refactor. retest_needed=false.
    - agent: "main"
      message: |
        Iteration 10 (Phase-2 refactor): Extracted 5 more components from app/index.tsx (1889 → 1451 lines).
          - src/components/NewFileModal.tsx (uses shared Sheet wrapper)
          - src/components/LangMenu.tsx (uses Sheet)
          - src/components/BtInfoModal.tsx (uses Sheet)
          - src/components/ShortcutsSheet.tsx (owns local SHORTCUTS const)
          - src/components/FileDrawer.tsx (Animated.View + full projects/files/footer)
        42 now-orphaned styles removed from index.tsx StyleSheet.
    - agent: "testing"
      message: |
        Iteration 10: 14/14 checks PASSED. Drawer, LangMenu, NewFileModal, BtInfoModal, ShortcutsSheet all correctly prop-wired with testIDs intact. All Phase-1 features from iterations 6-9 still work. Only pre-existing RN-Web deprecation warnings carry over. retest_needed=false.
    - agent: "main"
      message: |
        Iteration 11: shipped two novice-focused features.
          Feature 1: Auto-strip Markdown fences on paste — new pure helper src/lib/paste.ts::stripMarkdownFences() wired into the editor via handleCodeChange (heuristic: >5-char diff + contains ``` triggers strip). Shows a "Fences stripped" paste-toast.
          Feature 2: One-tap "Why?" / "Explain output" button in the console sheet header — packages current code + terminal output with an ELI5 tutor prompt, writes to syntax.pending_prompt, dismisses the console sheet, and navigates to /ai. Icon+label switch based on whether stderr is present.
          Feature 2b: New "Apply Fix" button on the first code block of assistant replies (ai.tsx MessageBubble). Writes to syntax.pending_replace; index.tsx now reads both pending_replace and pending_insert on focus — replace wins and REPLACES editor content (with defensive fence re-strip).
    - agent: "testing"
      message: |
        Iteration 11: 20/20 checks PASSED. Both features work end-to-end including real Gemini 3 Pro round-trip. All prior regression checks (palettes, RECENT, sections, Push, ⌘S) still green. Two minor advisories (console sheet lingers on /ai; RN-Web shadow*/pointerEvents deprecations) — main agent applied the sheet-dismiss fix; deprecation warnings deferred as pre-existing.
    - agent: "main"
      message: |
        Iteration 12: shipped Episode Mode (critical accessibility feature).
          - New src/lib/episode-store.ts (persisted global state, useEpisodeMode hook) and src/lib/episode-idb.ts (IndexedDB on web, AsyncStorage on native; fire-and-forget keystroke autosave with 500-entry log cap).
          - FileDrawer footer: new Episode toggle row above Sync (visible without scrolling).
          - Header: moon badge next to filename when ON; overlay (rgba black 18%) covers entire SafeAreaView.
          - Orientation: expo-screen-orientation locks portrait on native, no-op on web.
          - Silenced: Saved / Fences-stripped toasts suppressed when ON.
          - Silent push: header push icon bypasses PushModal when Episode ON, using saved PAT+config; tiny green/red dot on the icon. Falls back to opening modal if no saved config.
          - Command Palette entry to toggle.
    - agent: "testing"
      message: |
        Iteration 12: 8/11 PASS, 2 HIGH bugs, 1 could-not-verify (IDB inspection env limit).
          BUG 1: Switch double-toggle (row Pressable + Switch both called toggle).
          BUG 2: Silent-push fallback modal didn't open (later revealed to be a test-timing artifact — modal DID open, main-agent verified).
    - agent: "main"
      message: |
        Iteration 13: fixed both HIGH bugs.
          Fix 1: split episode-toggle into an outer View + inner Pressable ("episode-row") + Switch — only one handler fires per tap.
          Fix 2: verified silent-push fallback works; also fixed the deprecated `pointerEvents` prop on episode-overlay/push-dot by moving it into `style`.
    - agent: "testing"
      message: |
        Iteration 13: All fixes VERIFIED. Switch single-toggles; row single-toggles; fallback modal opens ~150ms; happy path shows push-dot-err ~300ms with dummy PAT (401 as expected). Regressions green. Reported one latent bug (silentGithubPush treated `res.ok` from pushToGitHub which returns {commitSha,url} — success would erroneously show err dot). retest_needed=false.
    - agent: "main"
      message: |
        Iteration 14: fixed the latent silent-push success bug — pushToGitHub throws on failure, so reaching the line after `await pushToGitHub(...)` always means success. Now `setSilentPushStatus("ok")` unconditionally after the awaited call resolves.