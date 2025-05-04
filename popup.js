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
          args: [blockList] // Pass the blocklist (now array of objects)
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
  list.forEach((item, index) => { // Item is now { text: '...', level: ... }
    const tag = document.createElement('span');
    tag.className = 'tag';

    const text = document.createElement('span');
    text.textContent = item.text; // Use item.text
    tag.appendChild(text);

    // Create number input for level
    const levelInput = document.createElement('input');
    levelInput.type = 'number';
    levelInput.value = item.level; // Use item.level
    levelInput.min = 0;
    levelInput.max = 100;
    levelInput.title = 'Parent levels to hide';
    levelInput.addEventListener('change', (e) => updateLevel(index, parseInt(e.target.value, 10)));
    levelInput.addEventListener('input', (e) => {
        // Optional: Clamp value immediately on input if needed, though 'change' is usually sufficient
        let value = parseInt(e.target.value, 10);
        if (isNaN(value)) value = 0; // Default to 0 if invalid
        if (value < 0) e.target.value = 0;
        if (value > 100) e.target.value = 100;
    });
    tag.appendChild(levelInput);

    const removeButton = document.createElement('button');
    removeButton.textContent = 'x';
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
      // Check if the word (text property) already exists
      if (!blockList.some(item => item.text === word)) {
        // Add as an object with default level 1
        blockList.push({ text: word, level: 1 });
        chrome.storage.sync.set({ blockList }, () => {
          console.log(`Added "${word}" (level 1) to blocklist.`);
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
    const removedItem = blockList.splice(indexToRemove, 1)[0]; // Remove item at index
    chrome.storage.sync.set({ blockList }, () => {
      console.log(`Removed "${removedItem.text}" from blocklist.`);
      displayBlockList(blockList); // Update display
    });
  });
}

// New function to update the level of a specific item
function updateLevel(index, newLevel) {
    if (isNaN(newLevel) || newLevel < 0 || newLevel > 100) {
        console.error("Invalid level provided. Must be between 0 and 100.");
        // Optionally, reset the input visually here if the browser didn't clamp it
        loadBlockList(); // Reload to reset the view if clamping fails
        return;
    }
    chrome.storage.sync.get(['blockList'], (result) => {
        const blockList = result.blockList || [];
        if (blockList[index]) {
            blockList[index].level = newLevel;
            chrome.storage.sync.set({ blockList }, () => {
                console.log(`Updated level for "${blockList[index].text}" to ${newLevel}.`);
                // No need to call displayBlockList again, the input value is already updated visually.
                // However, if clamping failed, a reload might be needed.
            });
        } else {
            console.error("Attempted to update level for non-existent item at index:", index);
        }
    });
}

// This function will be injected into the content page
function injectContentScript(blockListToUse) { // blockListToUse is [{text: '...', level: ...}]
    // console.log("[Forcefield] Injecting content script with blocklist:", blockListToUse); // Less verbose

    function blockListedContent(blockList) {
        console.log(`[Forcefield] Starting scan for ${blockList.length} words/phrases.`);
        const allElements = document.body.getElementsByTagName('*');
        let elementsHidden = 0;
        const hiddenMarker = 'hiddenByForcefield'; // Use a constant for the dataset key

        // Iterate backwards through all elements
        for (let i = allElements.length - 1; i >= 0; i--) {
            const element = allElements[i];

            // Skip elements that are already hidden by means other than this script
            if (element.style.display === 'none' && !element.dataset[hiddenMarker]) {
                continue;
            }
            // Skip elements without any text content
            if (!element.textContent || !element.textContent.trim()) {
                 continue;
            }

            // --- Focus on potential leaf nodes for checking --- 
            if (element.children.length === 0) {
                const text = element.textContent.toLowerCase();

                // Check if text contains any blocked word/phrase
                let foundMatch = null;
                for (const item of blockList) {
                    if (text.includes(item.text.toLowerCase())) {
                        foundMatch = item;
                        break;
                    }
                }

                if (foundMatch) {
                    const levelsToAscend = foundMatch.level;

                    // Find the target element by ascending the DOM
                    let elementToHide = element;
                    for (let j = 0; j < levelsToAscend && elementToHide.parentElement; j++) {
                        elementToHide = elementToHide.parentElement;
                    }

                    // Check if the target is valid and not already hidden by this script
                    if (elementToHide && elementToHide.style.display !== 'none') {
                        // Prevent hiding the entire body or html elements
                        if (elementToHide === document.body || elementToHide === document.documentElement) {
                            console.warn(`[Forcefield] Avoided hiding BODY/HTML for "${foundMatch.text}".`);
                            continue;
                        }

                        // Hide the element and mark it
                        // console.log(`[Forcefield] Hiding element (level ${levelsToAscend} ancestor) for "${foundMatch.text}":`, elementToHide); // Less verbose
                        elementToHide.style.display = 'none';
                        elementToHide.dataset[hiddenMarker] = 'true';
                        elementsHidden++;
                    }
                }
            }
        }
        if (elementsHidden > 0) {
            console.log(`[Forcefield] Scan finished. Hid ${elementsHidden} elements/ancestors.`);
        } else {
            console.log(`[Forcefield] Scan finished. No new elements hidden.`);
        }
    }

    // Run the blocking logic
    blockListedContent(blockListToUse);
}

// Initial load is handled by DOMContentLoaded