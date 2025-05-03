const wordInput = document.getElementById('wordInput');
const addButton = document.getElementById('addButton');
const blockListDiv = document.getElementById('blockList');
const blockButton = document.getElementById('blockButton');

// Load and display the blocklist when the popup opens
document.addEventListener('DOMContentLoaded', loadBlockList);

// Add word to blocklist
addButton.addEventListener('click', addWord);
wordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addWord();
  }
});

// Trigger content script
blockButton.addEventListener('click', () => {
  chrome.storage.sync.get(['blockList'], (result) => {
    const blockList = result.blockList || [];
    if (blockList.length === 0) {
        console.log("Blocklist is empty. Nothing to block.");
        // Optionally, provide user feedback here, e.g., alert("Blocklist is empty.")
        return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: injectContentScript,
          args: [blockList] // Pass the blocklist as an argument
        }).catch(err => console.error("Error injecting script: ", err));
      } else {
        console.error("Could not get active tab ID.");
      }
    });
  });
});

function loadBlockList() {
  chrome.storage.sync.get(['blockList'], (result) => {
    const blockList = result.blockList || [];
    displayBlockList(blockList);
  });
}

function displayBlockList(list) {
  blockListDiv.innerHTML = ''; // Clear current list
  list.forEach((word, index) => {
    const tag = document.createElement('span');
    tag.className = 'tag';

    const text = document.createElement('span');
    text.textContent = word;
    tag.appendChild(text);

    const removeButton = document.createElement('button');
    removeButton.textContent = '×'; // Use '×' for close symbol
    removeButton.title = 'Remove'; // Add tooltip
    removeButton.addEventListener('click', () => removeWord(index));
    tag.appendChild(removeButton);

    blockListDiv.appendChild(tag);
  });
}

function addWord() {
  const word = wordInput.value.trim();
  if (word) {
    chrome.storage.sync.get(['blockList'], (result) => {
      const blockList = result.blockList || [];
      if (!blockList.includes(word)) { // Avoid duplicates
        blockList.push(word);
        chrome.storage.sync.set({ blockList }, () => {
          console.log(`Added "${word}" to blocklist.`);
          displayBlockList(blockList); // Update display
          wordInput.value = ''; // Clear input
        });
      } else {
          console.log(`"${word}" is already in the blocklist.`);
          wordInput.value = ''; // Clear input even if duplicate
      }
    });
  }
}

function removeWord(indexToRemove) {
  chrome.storage.sync.get(['blockList'], (result) => {
    const blockList = result.blockList || [];
    const removedWord = blockList.splice(indexToRemove, 1)[0]; // Remove word at index
    chrome.storage.sync.set({ blockList }, () => {
      console.log(`Removed "${removedWord}" from blocklist.`);
      displayBlockList(blockList); // Update display
    });
  });
}

// This function will be injected into the content page
// It needs to be self-contained or rely on functions defined within it.
function injectContentScript(blockListToUse) {
    console.log("[Forcefield] Injecting content script with blocklist:", blockListToUse);

    function blockListedContent(blockList) {
        console.log(`[Forcefield] Starting scan for ${blockList.length} words/phrases.`);
        // First, unhide previously hidden elements to reflect the new list accurately? (Optional but potentially better UX)
        // Or maybe better: store originally hidden elements and only re-hide based on the *new* list?
        // For simplicity now, let's just re-run the hiding logic. Existing hidden elements will remain hidden if they still match.
        // Elements that *no longer* match won't be explicitly unhidden by this simple version.

        const allElements = document.body.getElementsByTagName('*');
        let elementsHidden = 0;

        // Iterate backwards to avoid issues with indices changing
        for (let i = allElements.length - 1; i >= 0; i--) {
            const element = allElements[i];

            // Basic check if element might contain text and isn't hidden itself
            // Check if the element *itself* is hidden. If so, skip.
            // We want to check content even if a parent is hidden, in case the parent hiding changes.
             if (element.style.display === 'none' && element.dataset.hiddenByForcefield !== 'true') {
                 // If it's hidden but not by us, leave it alone.
                continue;
            }
             if (!element.textContent) {
                  continue; // Skip elements with no text content at all
             }


            // Reset our specific hidden marker if it exists (needed if words are removed from blocklist)
            // This is getting complex, maybe a simpler approach is better for now.
            // Let's stick to just re-hiding for now.
            // if (element.dataset.hiddenByForcefield) {
            //     element.style.display = ''; // Reset display
            //     delete element.dataset.hiddenByForcefield;
            // }


            // Check if it's a potential 'leaf node' (no element children, has trimmed text)
             // Consider elements that might have text even with children, but prioritize leaves
            if (element.children.length === 0 && element.textContent.trim()) {
                const text = element.textContent.toLowerCase();

                 // Check against each word/phrase in the blocklist
                let foundMatch = false;
                for (const blockedWord of blockList) {
                    if (text.includes(blockedWord.toLowerCase())) {
                        foundMatch = true;
                        break; // Found a match, no need to check further for this element
                    }
                }

                if (foundMatch) {
                    // Find a suitable parent element to hide
                    let containerToHide = element.parentElement;
                    // console.log(`[Forcefield] Found blocked content in leaf node:`, element); // Less verbose logging

                    // Hide the parent element if it exists and isn't already hidden by us
                    // We check containerToHide.style.display !== 'none' OR if it was hidden by us previously
                    if (containerToHide && (containerToHide.style.display !== 'none' || containerToHide.dataset.hiddenByForcefield === 'true')) {
                        if (containerToHide === document.body || containerToHide === document.documentElement) {
                            console.warn("[Forcefield] Attempted to hide BODY or HTML element. Skipping.", element);
                            continue; // Don't hide body/html
                        }

                         // Check if already hidden *by this script* to avoid redundant logging/action
                         if (containerToHide.style.display !== 'none') {
                             console.log(`[Forcefield] Hiding parent element:`, containerToHide);
                             containerToHide.style.display = 'none';
                             containerToHide.dataset.hiddenByForcefield = 'true'; // Mark as hidden by us
                             elementsHidden++;
                         }

                    } else if (!containerToHide) {
                        // console.warn("[Forcefield] Leaf node found but has no parent element.", element); // Less verbose
                    } else {
                        // Parent is already hidden, potentially by other means or previous run
                    }
                }
                 // Experimental: If a leaf node *doesn't* match anymore, should we unhide its parent?
                 // This requires tracking what was hidden. Let's skip for now.

            }
             // Simplified: Don't check non-leaf nodes for now to avoid hiding large sections unintentionally.
        }
        console.log(`[Forcefield] Scan finished. Hid ${elementsHidden} new parent elements in this run.`);
    }

    // Directly call the blocking function every time the script is injected
    blockListedContent(blockListToUse);

}

// Initial load is handled by DOMContentLoaded
// Initial load is handled by DOMContentLoaded