package ledger

import "errors"

var (
	errEmptyLeafSet        = errors.New("ledger: cannot seal an empty batch/epoch")
	errLeafIndexOutOfRange = errors.New("ledger: leaf index out of range")
	errRedacted            = errors.New("ledger: evidence payload redacted — unavailable, not missing")
	errUnknownEvidenceID   = errors.New("ledger: unknown evidence id")
)
