/**
 * Tanaghum Progress Bar Component
 */

/**
 * Create a progress bar element
 * @param {Object} options - Configuration options
 * @returns {Object} Progress bar controller
 */
export function createProgressBar(options = {}) {
  const {
    container,
    showLabel = true,
    showPercentage = true,
    animated = true,
    height = '8px'
  } = options;

  // Create elements
  const wrapper = document.createElement('div');
  wrapper.className = 'progress-wrapper';

  if (showLabel) {
    const labelContainer = document.createElement('div');
    labelContainer.className = 'progress-labels';
    labelContainer.innerHTML = `
      <span class="progress-label"></span>
      ${showPercentage ? '<span class="progress-percentage">0%</span>' : ''}
    `;
    wrapper.appendChild(labelContainer);
  }

  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  bar.style.height = height;

  const fill = document.createElement('div');
  fill.className = 'progress-bar-fill';
  if (animated) {
    fill.style.transition = 'width 0.3s ease';
  }

  bar.appendChild(fill);
  wrapper.appendChild(bar);

  // Add to container if provided
  if (container) {
    if (typeof container === 'string') {
      document.querySelector(container).appendChild(wrapper);
    } else {
      container.appendChild(wrapper);
    }
  }

  // Controller object
  const controller = {
    element: wrapper,

    /**
     * Set progress value
     * @param {number} value - Value between 0 and 100
     * @param {string} [label] - Optional label text
     */
    set(value, label) {
      const clampedValue = Math.max(0, Math.min(100, value));
      fill.style.width = `${clampedValue}%`;

      if (showPercentage) {
        const percentEl = wrapper.querySelector('.progress-percentage');
        if (percentEl) {
          percentEl.textContent = `${Math.round(clampedValue)}%`;
        }
      }

      if (label !== undefined && showLabel) {
        const labelEl = wrapper.querySelector('.progress-label');
        if (labelEl) {
          labelEl.textContent = label;
        }
      }

      return this;
    },

    /**
     * Get current progress value
     * @returns {number}
     */
    get() {
      return parseFloat(fill.style.width) || 0;
    },

    /**
     * Set indeterminate state
     * @param {boolean} indeterminate
     */
    setIndeterminate(indeterminate) {
      fill.classList.toggle('indeterminate', indeterminate);
      if (indeterminate) {
        fill.style.width = '30%';
      }
      return this;
    },

    /**
     * Set label text
     * @param {string} text
     */
    setLabel(text) {
      const labelEl = wrapper.querySelector('.progress-label');
      if (labelEl) {
        labelEl.textContent = text;
      }
      return this;
    },

    /**
     * Set color/variant
     * @param {string} variant - 'primary' | 'success' | 'warning' | 'error'
     */
    setVariant(variant) {
      fill.className = 'progress-bar-fill';
      fill.classList.add(`progress-${variant}`);
      return this;
    },

    /**
     * Reset to 0
     */
    reset() {
      fill.style.width = '0%';
      fill.classList.remove('indeterminate');
      if (showPercentage) {
        const percentEl = wrapper.querySelector('.progress-percentage');
        if (percentEl) percentEl.textContent = '0%';
      }
      return this;
    },

    /**
     * Complete (set to 100%)
     * @param {string} [label] - Optional completion label
     */
    complete(label) {
      return this.set(100, label || 'Complete');
    },

    /**
     * Remove from DOM
     */
    destroy() {
      wrapper.remove();
    }
  };

  return controller;
}

/**
 * Create a step progress indicator
 * @param {Object} options - Configuration options
 * @returns {Object} Step progress controller
 */
export function createStepProgress(options = {}) {
  const {
    container,
    steps = [],
    currentStep = 0
  } = options;

  const wrapper = document.createElement('div');
  wrapper.className = 'step-indicator';

  // Build steps HTML
  steps.forEach((step, index) => {
    if (index > 0) {
      const connector = document.createElement('div');
      connector.className = 'step-connector';
      connector.dataset.index = index;
      wrapper.appendChild(connector);
    }

    const stepEl = document.createElement('div');
    stepEl.className = 'step';
    stepEl.dataset.index = index;

    stepEl.innerHTML = `
      <div class="step-number">${index + 1}</div>
      <span class="step-label">${step}</span>
    `;

    wrapper.appendChild(stepEl);
  });

  // Add to container
  if (container) {
    if (typeof container === 'string') {
      document.querySelector(container).appendChild(wrapper);
    } else {
      container.appendChild(wrapper);
    }
  }

  // Controller
  const controller = {
    element: wrapper,
    currentStep: currentStep,

    /**
     * Go to a specific step
     * @param {number} index - Step index (0-based)
     */
    goTo(index) {
      this.currentStep = index;

      wrapper.querySelectorAll('.step').forEach((el, i) => {
        el.classList.remove('active', 'completed');
        if (i < index) {
          el.classList.add('completed');
        } else if (i === index) {
          el.classList.add('active');
        }
      });

      wrapper.querySelectorAll('.step-connector').forEach((el, i) => {
        el.classList.toggle('completed', i < index);
      });

      return this;
    },

    /**
     * Move to next step
     */
    next() {
      if (this.currentStep < steps.length - 1) {
        this.goTo(this.currentStep + 1);
      }
      return this;
    },

    /**
     * Move to previous step
     */
    prev() {
      if (this.currentStep > 0) {
        this.goTo(this.currentStep - 1);
      }
      return this;
    },

    /**
     * Reset to first step
     */
    reset() {
      return this.goTo(0);
    },

    /**
     * Complete all steps
     */
    complete() {
      wrapper.querySelectorAll('.step').forEach(el => {
        el.classList.remove('active');
        el.classList.add('completed');
      });
      wrapper.querySelectorAll('.step-connector').forEach(el => {
        el.classList.add('completed');
      });
      this.currentStep = steps.length;
      return this;
    },

    /**
     * Remove from DOM
     */
    destroy() {
      wrapper.remove();
    }
  };

  // Initialize to current step
  controller.goTo(currentStep);

  return controller;
}
