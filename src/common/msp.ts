// Copyright 2026 The MathWorks, Inc.
//
// The facts a Managed Simulink Project adds to a MATLAB Project, as they travel to the
// project page.
//
// PROOF OF CONCEPT, and deliberately additive. MSP is an unshipped toolkit, so every
// field here arrives through ONE optional key on `setProject`: a project that is not an
// MSP carries no `msp`, and the page then renders exactly the markup it rendered
// before. Nothing in this file can change how an ordinary MATLAB Project is presented.
//
// If it ships, this projection belongs in core beside ProjectPage.ts — it is derived
// from the parse, and every host should derive it the same way. It lives here for now
// because core is public and this toolkit is not.
//
// The two words this exists to teach:
//   INTERFACE  the half of a project other projects can see. `<Name>_Interface.sldd`
//              holds TYPES (buses, alias and numeric types, enums), and referencing a
//              project chains its interface dictionary into yours.
//   COMPONENT  a referenced MSP project. The toolkit's own word — `msp.getStatus`
//              reports `components` as "table of referenced MSP projects" — so it is a
//              project-level noun, not a subsystem or a Model block.

/** What role an MSP project plays in a composition. */
export type MspRole =
  /** A simulatable component: private values of its own, plus a published interface. */
  | 'component'
  /** Shared types only: an interface for others to chain, with no private values. */
  | 'common';

/** One of the two dictionaries an MSP project keeps, and which half it is. */
export interface MspDictionary {
  kind: 'interface' | 'private';
  /** Project-root-relative path to the `.sldd`, as the store spells it. */
  path: string;
}

export interface MspProject {
  role: MspRole;
  /**
   * Interface first, because it is the half that is public. A `common` project has no
   * private dictionary at all, so this can hold one entry.
   */
  dictionaries: MspDictionary[];
  /**
   * The name of the shared `Simulink.ConfigSet` entry inside the interface dictionary,
   * when this project keeps one. Not a path: it is an entry, not a file.
   */
  sharedConfigSetName?: string;
  /**
   * Where these facts came from, in the words the page shows. Worth carrying while this
   * is a proof of concept: the two detection routes disagree in useful ways (a store
   * whose labels were stripped still has its config file, and vice versa), and a page
   * that says which one answered is a page that can be debugged from a screenshot.
   */
  evidence: string[];
}

/** English for a role, for the page's identity line. */
export const MSP_ROLE_LABEL: Record<MspRole, string> = {
  component: 'component',
  common: 'shared interface',
};
