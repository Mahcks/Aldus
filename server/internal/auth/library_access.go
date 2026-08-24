package auth

import (
	"fmt"
)

// EffectiveLibraryAccessSQL returns the catalog visibility predicate for a
// trusted SQL expression that identifies a library. An exclusive membership
// overrides every additive membership for that user. Administrators retain
// implicit access to every library only when they have no exclusive grant.
func EffectiveLibraryAccessSQL(libraryIDExpression string) string {
	return fmt.Sprintf(`(
		EXISTS(SELECT 1 FROM library_members exclusive_grant WHERE exclusive_grant.user_id=? AND exclusive_grant.library_id=%s AND exclusive_grant.exclusive=1)
		OR (
			NOT EXISTS(SELECT 1 FROM library_members exclusive_override WHERE exclusive_override.user_id=? AND exclusive_override.exclusive=1)
			AND (? OR EXISTS(SELECT 1 FROM library_members additive_grant WHERE additive_grant.user_id=? AND additive_grant.library_id=%s))
		)
	)`, libraryIDExpression, libraryIDExpression)
}

func LibraryAccessArgs(actor User) []any {
	return []any{actor.ID, actor.ID, actor.Admin, actor.ID}
}
