# Permission matrix

This matrix is the intended policy and audit guide. Dedicated tests must confirm each operation.

| Role | Group and attendance | Homework and vocabulary |
| --- | --- | --- |
| student | Own membership and attendance where exposed | Own assignments and attempts, visible sets only |
| parent | Linked children only | Linked-child access on the routes that explicitly support it |
| teacher | Assigned groups, authorized roster, scoped attendance and exports | Own cohorts and collections, authorized students and class results |
| admin | Administrative scope defined by each server endpoint | Administrative scope defined by each server endpoint |
| super_admin | Explicit elevated server routes | Explicit elevated server routes |
| instructor | Desktop recognizes the label. Verify persisted support and endpoint policy before granting shared access. | No implicit authorization from the desktop label |
| unknown | Deny privileged operations | Deny privileged operations |

Review `common/auth/authentication.py`, group and attendance services, vocabulary visibility, exam reports and teacher homework views. Enforce ownership within atomic mutations as well as read filters. Cache entries must be scoped to account. Export queries require the same server scope as on-screen data.
