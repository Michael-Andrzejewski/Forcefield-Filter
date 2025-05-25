// Shared content blocking logic
function createContentBlocker() {
    const HIDDEN_MARKER = 'hiddenByForcefield';
    const DEBUG_CLASS = 'forcefield-debug-highlight';
    const DEBUG_STYLE = 'background-color: rgba(255, 0, 0, 0.3) !important; border: 1px solid red !important; display: revert !important; visibility: revert !important;';

    function normalizeText(str) {
        return str?.replace(/[\u2018\u2019\u0060\u00B4]/g, "'").toLowerCase();
    }

    function resetElements() {
        document.querySelectorAll(`[data-${HIDDEN_MARKER}], .${DEBUG_CLASS}`).forEach(el => {
            el.style.cssText = '';
            el.classList.remove(DEBUG_CLASS);
            delete el.dataset[HIDDEN_MARKER];
        });
    }

    function findTargetElement(element, levels) {
        let target = element;
        for (let i = 0; i < levels && target.parentElement; i++) {
            if (target.parentElement === document.body || target.parentElement === document.documentElement) break;
            target = target.parentElement;
        }
        return target;
    }

    function applyEffect(element, debugMode, blockItem) {
        if (debugMode) {
            if (!element.classList.contains(DEBUG_CLASS)) {
                element.style.cssText += DEBUG_STYLE;
                element.classList.add(DEBUG_CLASS);
                element.dataset[HIDDEN_MARKER] = 'debug';
                return true;
            }
        } else {
            if (element.style.display !== 'none') {
                element.style.display = 'none';
                element.dataset[HIDDEN_MARKER] = 'true';
                return true;
            }
        }
        return false;
    }

    return function blockContent(blockList, debugMode = false) {
        resetElements();
        
        let affected = 0;
        const elements = document.body.getElementsByTagName('*');
        
        for (let i = elements.length - 1; i >= 0; i--) {
            const element = elements[i];
            if (element.style.display === 'none' && !element.dataset[HIDDEN_MARKER]) continue;

            // Check text nodes for matches
            const match = Array.from(element.childNodes)
                .filter(node => node.nodeType === 3 && node.nodeValue?.trim())
                .find(node => {
                    const normalizedText = normalizeText(node.nodeValue);
                    return blockList.find(item => normalizedText.includes(normalizeText(item.text)));
                });

            if (match) {
                const blockItem = blockList.find(item => 
                    normalizeText(match.nodeValue).includes(normalizeText(item.text))
                );
                const target = findTargetElement(element, blockItem.level);
                
                if (target && target !== document.body && target !== document.documentElement) {
                    if (applyEffect(target, debugMode, blockItem)) affected++;
                }
            }
        }

        console.log(`[Forcefield] ${debugMode ? 'Highlighted' : 'Hidden'} ${affected} elements`);
        return affected;
    };
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.forcefieldBlockContent = createContentBlocker();
} 