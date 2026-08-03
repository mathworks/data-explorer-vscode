// Copyright 2026 The MathWorks, Inc.

import { css } from 'lit';

/**
 * Forced-colors / high-contrast mode styles.
 * Ensures all interactive elements have visible borders and focus indicators
 * when the OS is in forced-colors (Windows High Contrast) mode.
 */
export const highContrastStyles = css`
  @media (forced-colors: active) {
    button,
    [role='button'],
    [tabindex] {
      border: 1px solid ButtonText !important;
    }

    button:focus-visible,
    [role='button']:focus-visible,
    [tabindex]:focus-visible {
      outline: 2px solid Highlight !important;
      outline-offset: 2px !important;
    }

    button:disabled,
    [role='button'][aria-disabled='true'] {
      border-color: GrayText !important;
      color: GrayText !important;
    }

    input,
    select,
    textarea {
      border: 1px solid ButtonText !important;
    }

    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible {
      outline: 2px solid Highlight !important;
      outline-offset: 1px !important;
    }

    a {
      color: LinkText !important;
    }

    [aria-selected='true'],
    .selected {
      outline: 2px solid Highlight !important;
      outline-offset: -2px !important;
    }
  }
`;
