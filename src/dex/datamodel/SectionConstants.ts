// Copyright 2026 The MathWorks, Inc.

export const NS_DESIGN = 'dacaf35e-55a5-454d-a7c1-93db038a210e';
export const NS_CONFIGURATIONS = 'a3b2532e-8e6e-47f5-94fb-b15daf666a84';
export const NS_OTHER = '42516768-0ace-4981-8ac7-0a9b32cba471';

export const SECTION_NAMESPACE: Record<string, string> = {
    design: NS_DESIGN,
    arch: NS_DESIGN,
    config: NS_CONFIGURATIONS,
    other: NS_OTHER
};

export function getSectionKey(meta: Record<string, unknown>): string {
    const ns = (meta.namespace as string) || '';
    const isDerived = meta.isderived === '1';

    if (ns === NS_DESIGN && isDerived) { return 'arch'; }
    if (ns === NS_DESIGN) { return 'design'; }
    if (ns === NS_CONFIGURATIONS) { return 'config'; }
    if (ns === NS_OTHER) { return 'other'; }
    return 'design';
}

export function getSectionMetadata(sectionKey: string): { namespace: string; isderived: string } {
    return {
        namespace: SECTION_NAMESPACE[sectionKey] || NS_OTHER,
        isderived: sectionKey === 'arch' ? '1' : '0'
    };
}
