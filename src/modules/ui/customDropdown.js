/**
 * customDropdown.js — Accessible Dark UI Custom Dropdown Component.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Replaces or enhances native <select> elements with 100% dark-themed,
 * custom-styled, accessible popups in Chromium/Electron and browser environments.
 *
 * GUARANTEES:
 * 1. Two-way synchronization with underlying <select> element (dispatches native 'change' & 'input' events).
 * 2. Full keyboard accessibility (ArrowUp, ArrowDown, Enter, Space, Escape, Tab).
 * 3. Guaranteed dark-theme background and text colors across all OS window managers.
 * 4. Automatic click-outside dismissal.
 */

export class CustomDropdown {
  /**
   * @param {HTMLSelectElement} selectElement
   */
  constructor(selectElement) {
    if (!selectElement || selectElement.tagName !== 'SELECT') {
      throw new Error('[CustomDropdown] Target must be a valid HTMLSelectElement');
    }

    this.select = selectElement;
    this.wrapper = null;
    this.trigger = null;
    this.menu = null;
    this.isOpen = false;
    this.focusedIndex = -1;

    this._onDocClick = this._onDocClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onSelectChange = this._onSelectChange.bind(this);

    this._init();
  }

  _init() {
    // Hide native select visually but keep in DOM for form/event compatibility
    this.select.style.display = 'none';

    // Wrapper container
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'custom-dropdown';
    this.wrapper.setAttribute('role', 'combobox');
    this.wrapper.setAttribute('aria-expanded', 'false');
    this.wrapper.setAttribute('aria-haspopup', 'listbox');

    // Trigger button
    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'custom-dropdown-trigger';
    this.trigger.setAttribute('tabindex', '0');

    const labelSpan = document.createElement('span');
    labelSpan.className = 'custom-dropdown-label';
    const selectedOption = this.select.options[this.select.selectedIndex];
    labelSpan.textContent = selectedOption ? selectedOption.text : '';

    const chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevronSvg.setAttribute('width', '12');
    chevronSvg.setAttribute('height', '12');
    chevronSvg.setAttribute('viewBox', '0 0 24 24');
    chevronSvg.setAttribute('fill', 'none');
    chevronSvg.setAttribute('stroke', 'currentColor');
    chevronSvg.setAttribute('stroke-width', '2.5');
    chevronSvg.setAttribute('stroke-linecap', 'round');
    chevronSvg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm6 9 6 6 6-6');
    chevronSvg.appendChild(path);

    this.trigger.appendChild(labelSpan);
    this.trigger.appendChild(chevronSvg);

    // Dropdown listbox menu
    this.menu = document.createElement('div');
    this.menu.className = 'custom-dropdown-menu';
    this.menu.setAttribute('role', 'listbox');

    this._buildOptions();

    this.wrapper.appendChild(this.trigger);
    this.wrapper.appendChild(this.menu);

    // Insert wrapper into DOM immediately after the native select
    this.select.parentNode.insertBefore(this.wrapper, this.select.nextSibling);

    // Event listeners
    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.wrapper.addEventListener('keydown', this._onKeyDown);
    this.select.addEventListener('change', this._onSelectChange);
    document.addEventListener('click', this._onDocClick);
  }

  _buildOptions() {
    this.menu.innerHTML = '';
    Array.from(this.select.options).forEach((opt, idx) => {
      const item = document.createElement('div');
      item.className = 'custom-dropdown-item' + (idx === this.select.selectedIndex ? ' selected' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', idx === this.select.selectedIndex ? 'true' : 'false');
      item.dataset.value = opt.value;
      item.dataset.index = idx;
      item.textContent = opt.text;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectIndex(idx);
        this.close();
      });

      this.menu.appendChild(item);
    });
  }

  selectIndex(index) {
    if (index < 0 || index >= this.select.options.length) return;
    this.select.selectedIndex = index;
    this._updateUI();

    // Dispatch native events so listeners (e.g. settingsManager) receive changes
    this.select.dispatchEvent(new Event('change', { bubbles: true }));
    this.select.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _updateUI() {
    const selectedOption = this.select.options[this.select.selectedIndex];
    const labelSpan = this.trigger.querySelector('.custom-dropdown-label');
    if (labelSpan && selectedOption) {
      labelSpan.textContent = selectedOption.text;
    }

    const items = this.menu.querySelectorAll('.custom-dropdown-item');
    items.forEach((item, idx) => {
      const isSel = idx === this.select.selectedIndex;
      item.classList.toggle('selected', isSel);
      item.setAttribute('aria-selected', isSel ? 'true' : 'false');
    });
  }

  _onSelectChange() {
    this._updateUI();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.wrapper.classList.add('open');
    this.wrapper.setAttribute('aria-expanded', 'true');
    this.focusedIndex = this.select.selectedIndex;
    this._highlightFocusedItem();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.wrapper.classList.remove('open');
    this.wrapper.setAttribute('aria-expanded', 'false');
    this._clearHighlights();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  _highlightFocusedItem() {
    const items = this.menu.querySelectorAll('.custom-dropdown-item');
    items.forEach((item, idx) => {
      item.classList.toggle('focused', idx === this.focusedIndex);
      if (idx === this.focusedIndex) {
        item.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  _clearHighlights() {
    const items = this.menu.querySelectorAll('.custom-dropdown-item');
    items.forEach(item => item.classList.remove('focused'));
  }

  _onKeyDown(e) {
    if (!this.isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.open();
      }
      return;
    }

    const maxIdx = this.select.options.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.focusedIndex = Math.min(this.focusedIndex + 1, maxIdx);
      this._highlightFocusedItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
      this._highlightFocusedItem();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (this.focusedIndex >= 0) {
        this.selectIndex(this.focusedIndex);
        this.close();
        this.trigger.focus();
      }
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      this.close();
    }
  }

  _onDocClick(e) {
    if (!this.wrapper.contains(e.target)) {
      this.close();
    }
  }

  refresh() {
    this._buildOptions();
    this._updateUI();
  }

  destroy() {
    document.removeEventListener('click', this._onDocClick);
    this.wrapper.removeEventListener('keydown', this._onKeyDown);
    this.select.removeEventListener('change', this._onSelectChange);
    if (this.wrapper?.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper);
    }
    this.select.style.display = '';
  }
}

/**
 * Enhances all select elements matching selector in the container with CustomDropdown.
 * @param {string} [selector='select.styled-select']
 * @param {HTMLElement} [container=document]
 * @returns {CustomDropdown[]}
 */
export function enhanceSelects(selector = 'select.styled-select', container = document) {
  const elements = container.querySelectorAll(selector);
  const instances = [];
  elements.forEach(select => {
    if (!select._customDropdown) {
      const inst = new CustomDropdown(select);
      select._customDropdown = inst;
      instances.push(inst);
    } else {
      select._customDropdown.refresh();
      instances.push(select._customDropdown);
    }
  });
  return instances;
}

export default { CustomDropdown, enhanceSelects };
