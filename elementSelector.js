(() => {
    if (window.isSelectingForBlock) {
        return;
    }
    window.isSelectingForBlock = true;

    // Create an overlay to highlight elements
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.backgroundColor = 'rgba(0, 100, 255, 0.3)';
    overlay.style.border = '2px solid blue';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '99999999';
    overlay.style.transition = 'all 100ms ease'; // Make transition faster for a snappier feel
    document.body.appendChild(overlay);

    let lastTarget = null;

    // Function to clean up listeners and the overlay
    function cleanup() {
        document.removeEventListener('mouseover', mouseoverHandler);
        document.removeEventListener('click', clickHandler, true);
        document.removeEventListener('keydown', keydownHandler, true);
        if (overlay.parentNode) {
            overlay.remove();
        }
        window.isSelectingForBlock = false;
        console.log('[Forcefield] Element selection mode ended.');
    }

    // Highlight element on hover
    function mouseoverHandler(e) {
        const target = e.target;
        // Do not highlight the overlay itself, or the whole page.
        if (!target || target === overlay || target === document.body || target === document.documentElement) {
            return;
        }

        // If the target hasn't changed, no need to update.
        if (target === lastTarget) {
            return;
        }
        
        lastTarget = target;
        const rect = lastTarget.getBoundingClientRect();
        overlay.style.left = `${rect.left + window.scrollX}px`;
        overlay.style.top = `${rect.top + window.scrollY}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
    }

    // Handle the click on an element
    function clickHandler(e) {
        // Prevent the original click action
        e.preventDefault();
        e.stopPropagation();

        if (lastTarget) {
            const text = lastTarget.innerText || lastTarget.textContent || '';
            const trimmedText = text.trim();
            console.log('[Forcefield] Element selected. Text:', trimmedText);

            if (chrome.runtime && chrome.runtime.sendMessage) {
                // Send message for prompt refinement
                chrome.runtime.sendMessage({ command: "elementSelected", text: trimmedText });
                // Send message to add to blocklist and re-block the page
                chrome.runtime.sendMessage({ command: "addAndBlockSelectedText", text: trimmedText });
            }

            // Hide the selected element immediately
            lastTarget.style.display = 'none';
        }

        cleanup();
    }
    
    // Allow canceling selection with the Escape key
    function keydownHandler(e) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cleanup();
        }
    }

    // Add event listeners
    document.addEventListener('mouseover', mouseoverHandler);
    document.addEventListener('click', clickHandler, true); // Use capture phase to intercept click
    document.addEventListener('keydown', keydownHandler, true);

    console.log('[Forcefield] Element selection mode started. Click an element to select it or press Esc to cancel.');

})(); 