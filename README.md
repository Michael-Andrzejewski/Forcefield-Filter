# Forcefield

A Chrome extension that runs your social media feed through an LLM and blocks toxicity before you see it. Think of it as an ad blocker, but for ragebait, doomposting, and engagement farming.

Forcefield is built on a few beliefs:

- People are naturally good and happy by default. Most value is lost by bad content being added to a feed, not by good content being missing.
- People are often subconsciously drawn to content they don't consciously like. The average person engages more with a post that is wrong than with one that is right, so attention is a subpar optimizer for good content.
- Superpersuasion happens in the negative. It's hard to persuade someone that they like something, but easy to persuade someone that they don't.
- The only way to fix the misaligned incentives of social media (attention = ad revenue) is a system where you *consciously* choose what to block once, and the system then enforces that choice constantly with *no ongoing mental effort*. You can curate your own feed by hand, but it takes too much effort and eventually you give up and go back to doomscrolling.

If tools like this were widely used, clickbait and ragebait would stop paying.

## How it works

1. A content script watches the page for new text (on X/Twitter it extracts only tweet bodies and dedupes them, so you aren't billed twice for the same post).
2. New text is batched and sent to a small, cheap model (Claude Haiku by default) with a filtering prompt.
3. The model returns the specific statements that match your filter. Those phrases go on a local blocklist.
4. Matching posts are hidden, replaced with a "Blocked by Forcefield - click to reveal" box, or highlighted, depending on the mode you pick. Blocking also propagates down reply threads.

Everything runs locally in your browser except the LLM call itself, which goes directly from your browser to the provider you configure.

## Install

Forcefield is not on the Chrome Web Store yet. Load it unpacked:

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder.

## Setup

1. Get an API key. The default model is Claude Haiku, so you'll want an [Anthropic API key](https://platform.claude.com/). Gemini Flash-Lite is also supported with a Google AI key.
2. Click the Forcefield icon, flip on the **Developer** toggle in the header, open **API Keys**, and paste your key.
3. Pick a model under **AI Model** (Haiku 4.5 is the cheapest Claude option and the default).
4. Go to a site on your allowed list (X/Twitter and Quora by default; add others under **Sites to Scan**) and press **Start Scanning**.

Optional tuning, all in Developer mode:

- **AI System Prompt** defines what counts as blockable. Edit it freely; the default targets controversial, politically aggressive, negative, and low-effort statements.
- **Debug Settings** switch between replacing blocked posts with a click-to-reveal white box (the default), hiding them outright, or just highlighting matches in red.
- **Blocked Tags** shows the current blocklist. Each entry has a level number, which is how many parent elements get hidden along with the matched text. The AI button on an entry tells the model it made a mistake, so it refines its own prompt and unblocks that text.

## Cost

Scanning sends text to a paid API, so browsing costs real money (roughly cents per session with Haiku on tweet-only mode). Forcefield ships with a budget guard: spending is tracked from each response's token usage, and calls pause automatically at $1/hour or $2/day by default. Both limits are adjustable under **AI Budget** in Developer mode.

## Personalization

If you use X/Twitter, Forcefield logs your own likes, not-interested clicks, mutes, and blocks (locally, in extension storage). From that log it maintains a **taste profile**: an LLM-written summary (300 to 1000 words) of what you actually like and dislike. It always keeps a fixed two-section bullet structure (likes that must not be blocked, then dislikes that should be), each covering topics, accounts, tone and discourse quality, and other observations. The profile is generated automatically once enough activity exists and updated incrementally (previous profile plus new activity) after roughly 5000 tokens of new liked or disliked content accumulates.

Every blocking scan and every autonomous decision then receives this profile plus your 5 most recent liked posts and 5 most recent not-interested/muted/blocked posts verbatim, so the filter tracks your current taste without you editing prompts.

The profile is shown in the popup under **Your Taste Profile** (and under **Taste Profile** in Developer mode, which edits the same profile), along with when it was last built and how close it is to the next automatic update. You can **edit it directly** to steer what gets hidden (your edits are used as-is by every scan), or press **Regenerate** to rebuild it from your activity immediately. Clearing the box resets it so it gets rebuilt from scratch.

You can view, copy, or clear the underlying activity log in the popup too. Only human clicks are recorded; the autonomous agent's own actions are excluded.

## What the AI sees

Each blocking scan is one request with two parts. The system message is your system prompt with the taste profile appended. The user message wraps the new feed text in the content instructions. In brackets, which popup field (or source) each piece comes from:

```
━━━━━━━━━━━━━━━━ SYSTEM MESSAGE ━━━━━━━━━━━━━━━━

[system prompt: the "AI System Prompt" field]
Your task is to identify:
- (the kinds of statements you want blocked)
...
For each identified statement, wrap it precisely with <Negative> tags. ...

[taste profile: the "Taste Profile" field, plus your recent activity]
This user's taste profile, learned from their own activity. Treat it as the authority on borderline cases: never flag content matching their likes, and lean toward flagging content matching their dislikes.

---
A previous summary of the user's likes (important not to block)
- (topics, accounts, tone)
A previous summary of the user's dislikes (important to block)
- (topics, accounts, tone)
---

The 5 most recent posts the user LIKED (do NOT flag content like this):
- @handle: first 200 characters of the post
- ...

The 5 most recent posts the user marked not interested, muted, or blocked (DO flag content like this):
- @handle: first 200 characters of the post
- ...

━━━━━━━━━━━━━━━━ USER MESSAGE ━━━━━━━━━━━━━━━━

[content instructions: the "AI User Prompt Prefix" field]
Analyze the following text content and extract controversial, politically aggressive, non-technical, low-effort, non-insightful, or negative statements using <Negative> tags as instructed. Judge each statement against this user's taste profile as well as the general criteria:

----

[feed content: new text from the page]
Text of the first new tweet

Text of the second new tweet

...
----

Remember to only return the tagged statements, nothing else.
```

Notes:

- The taste block is left out entirely until a profile or some logged activity exists, and each list of 5 recent posts appears only once you have activity of that kind.
- On X/Twitter the feed content is tweet body text only: no names, handles, or like counts, with a blank line between tweets. On other sites it is the visible page text.
- The model's reply is just the `<Negative>...</Negative>` statements. Those go on the local blocklist.

## Autonomous curation (experimental, use with care)

The **Run Now & Watch** button injects an agent into your X tab that scrolls the feed, asks the model about each batch of posts, and clicks **Not interested** or **Mute** through X's own menus to train your algorithm. It never blocks or reports anyone, has hard caps (5 mutes, 20 not-interested, 150 posts, 8 minutes per session), and shows a live overlay with a Stop button.

Two warnings:

- **X may flag automated sessions.** Automated interaction can violate X's terms of service, and X has been observed responding to these sessions with human verification challenges. A nightly-at-midnight schedule exists behind a config (Developer mode, Debug Settings) but is off by default for exactly this reason; leaving it off is recommended. Only run sessions while you're watching, and stop if X starts challenging you.
- Mutes are account-level. The caps keep the blast radius small, but review the run summary in the popup afterward.

The page-filtering side of Forcefield (the ad-blocker-style hiding above) does not interact with X at all. It only hides things in your own browser, and is the recommended way to use this extension.

## Privacy and security notes

- Your API key is stored in `chrome.storage.sync`, which syncs across Chrome profiles signed into your Google account. It is sent only to the provider you chose (api.anthropic.com or generativelanguage.googleapis.com), directly from your browser.
- Page text from allowed sites is sent to that same provider for analysis. Don't add sites whose content you don't want leaving your machine.
- The blocklist, activity log, and spend log live in local extension storage. Nothing is sent to any server of ours; there is no server of ours.
- The manifest requests broad host permissions so the blocker can run on any site you add to the allowed list.

## Known issues

- Blocks too much content at times. The default prompt is aggressive on purpose; soften it in the popup if it's catching things you want.
- Text only. Images and videos slip through unless the model flags the caption.
- The blocklist grows over a long session. Use **Clear All** in Developer mode if matching starts to feel slow.
- X's DOM changes regularly. Selectors are written defensively (geometry checks instead of class names where possible), but a redesign can still break blocking until selectors are updated.

## Roadmap

- Fine-tune a small model so default blocking is much better.
- Non-LLM pre-filtering so the extension can run cheaper or free.
- A strictness dial and direct "block content like this" prompting.
- Better UI/UX.

## License

Copyright (c) 2026 Michael Andrzejewski. Licensed under the [GNU Affero General Public License v3.0](LICENSE).

You are free to use, modify, and share Forcefield, including at work. If you distribute a modified version, or run one as a network service, you must make your source available under the same license.

If you want to build on Forcefield in a closed-source or proprietary product, a separate commercial license is available. Open an issue or reach out on X ([@Soareverix](https://x.com/Soareverix)).
