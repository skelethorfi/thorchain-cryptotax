// A problem or note found while interpreting a bundle, returned as a value; the shell decides
// whether to print it, save it or fail the run
export type IssueKind =
    // No interpreter for the action type: no rows, and the action is saved for triage
    | 'unsupported'
    // The interpreter threw: no rows, and the action is saved with the error
    | 'failed'
    // Listed but deliberately not mapped (e.g. Midgard sends, which come from Viewblock until row 6)
    | 'ignored';

export interface Issue {
    kind: IssueKind;
    message: string;
}
