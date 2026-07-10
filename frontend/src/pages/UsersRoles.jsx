import { useState, useMemo } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTable } from '@/components/shared/data-table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Users, UserPlus, KeyRound, Ban, CheckCircle2, ShieldAlert, Shield, ShieldCheck, Mail, ShieldAlert as UserIcon } from 'lucide-react'

const initialUsers = [
  { id: '1', name: 'Dr. Amara Okafor', email: 'a.okafor@zoikomeds.io', role: 'Super Admin', status: 'Active', created: '2025-01-12' },
  { id: '2', name: 'Naveen Kumar', email: 'n.kumar@zoikomeds.io', role: 'Administrator', status: 'Active', created: '2025-03-14' },
  { id: '3', name: 'Sarah Jenkins', email: 's.jenkins@meridian.org', role: 'Pharmacy Manager', status: 'Active', created: '2025-05-19' },
  { id: '4', name: 'Hideo Tanaka', email: 'h.tanaka@tokyoclinic.jp', role: 'Pharmacist', status: 'Active', created: '2025-06-22' },
  { id: '5', name: 'Marta Souza', email: 'm.souza@gov.br', role: 'Government User', status: 'Active', created: '2025-07-02' },
  { id: '6', name: 'Clara Dupont', email: 'c.dupont@atlasbio.com', role: 'Enterprise User', status: 'Suspended', created: '2025-08-01' }
]

export default function UsersRoles() {
  const [users, setUsers] = useState(initialUsers)
  const [roleFilter, setRoleFilter] = useState('All')
  const [selectedUser, setSelectedUser] = useState(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isResetOpen, setIsResetOpen] = useState(false)

  // Add User Form state
  const [form, setForm] = useState({ name: '', email: '', role: 'Pharmacist' })

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      return roleFilter === 'All' || u.role === roleFilter
    })
  }, [users, roleFilter])

  const handleCreateUser = (e) => {
    e.preventDefault()
    if (!form.name || !form.email) return
    const newEntry = {
      id: String(users.length + 1),
      ...form,
      status: 'Active',
      created: new Date().toISOString().split('T')[0]
    }
    setUsers((prev) => [newEntry, ...prev])
    setIsAddOpen(false)
    setForm({ name: '', email: '', role: 'Pharmacist' })
  }

  const handleToggleStatus = (id) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== id) return u
        return { ...u, status: u.status === 'Active' ? 'Suspended' : 'Active' }
      })
    )
  }

  const handleResetPassword = () => {
    alert(`A password reset link has been dispatched to ${selectedUser?.email}`)
    setIsResetOpen(false)
  }

  const columns = [
    {
      key: 'name',
      header: 'Full Name',
      sortable: true,
      cell: (row) => (
        <div className="flex items-center gap-2 font-medium text-foreground">
          <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
            {row.name.split(' ').map((n) => n[0]).join('')}
          </div>
          <span>{row.name}</span>
        </div>
      )
    },
    {
      key: 'email',
      header: 'Email Address',
      cell: (row) => <span className="text-muted-foreground">{row.email}</span>
    },
    {
      key: 'role',
      header: 'Assigned Role',
      sortable: true,
      cell: (row) => {
        const colors = {
          'Super Admin': 'bg-primary/10 text-primary border-primary/20',
          'Administrator': 'bg-teal/10 text-teal border-teal/20',
          'Pharmacy Manager': 'bg-warning/10 text-warning border-warning/20',
          'Pharmacist': 'bg-indigo/10 text-indigo border-indigo/20',
          'Enterprise User': 'bg-sky/10 text-sky border-sky/20',
          'Government User': 'bg-slate-400/10 text-slate-500 border-slate-400/20'
        }
        return (
          <Badge className={`border ${colors[row.role] || 'bg-muted text-muted-foreground'}`}>
            {row.role}
          </Badge>
        )
      }
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      cell: (row) => (
        <Badge variant={row.status === 'Active' ? 'default' : 'destructive'}>
          {row.status}
        </Badge>
      )
    },
    {
      key: 'created',
      header: 'Date Enrolled',
      cell: (row) => <span className="text-xs text-muted-foreground">{row.created}</span>
    }
  ]

  const toolbar = (
    <div className="flex items-center gap-3">
      <select
        value={roleFilter}
        onChange={(e) => setRoleFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      >
        <option value="All">All Roles</option>
        <option value="Super Admin">Super Admins</option>
        <option value="Administrator">Administrators</option>
        <option value="Pharmacy Manager">Pharmacy Managers</option>
        <option value="Pharmacist">Pharmacists</option>
        <option value="Enterprise User">Enterprise Users</option>
        <option value="Government User">Government Users</option>
      </select>

      <Button size="sm" onClick={() => setIsAddOpen(true)} className="bg-primary hover:bg-primary/95 text-white flex gap-1 items-center">
        <UserPlus className="size-3.5" />
        Create User
      </Button>
    </div>
  )

  const rowActions = (row) => (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        title="Reset Password"
        onClick={() => {
          setSelectedUser(row)
          setIsResetOpen(true)
        }}
      >
        <KeyRound className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={row.status === 'Suspended' ? 'text-success' : 'text-danger'}
        onClick={() => handleToggleStatus(row.id)}
        title={row.status === 'Suspended' ? 'Activate User' : 'Suspend User'}
      >
        {row.status === 'Suspended' ? <CheckCircle2 className="size-4" /> : <Ban className="size-4" />}
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users & Roles"
        description="Provision platform credentials, assign access profiles, audit roles, and revoke permissions."
      />

      <Card className="border-border/70 bg-card">
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={filteredUsers}
            getRowId={(row) => row.id}
            searchable
            searchPlaceholder="Search by user name or email..."
            searchAccessor={(row) => `${row.name} ${row.email}`}
            toolbar={toolbar}
            rowActions={rowActions}
          />
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Provision User Credentials</DialogTitle>
            <DialogDescription>
              Set up platform permissions for a corporate team member or external collaborator.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Full Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. John Doe"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Email Address</label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                type="email"
                placeholder="e.g. j.doe@organization.org"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Security Access Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
              >
                <option value="Super Admin">Super Admin</option>
                <option value="Administrator">Administrator</option>
                <option value="Pharmacy Manager">Pharmacy Manager</option>
                <option value="Pharmacist">Pharmacist</option>
                <option value="Enterprise User">Enterprise User</option>
                <option value="Government User">Government User</option>
              </select>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Deploy Credentials</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle className="flex gap-2 items-center text-primary">
              <KeyRound className="size-5" />
              Reset Access Credentials
            </DialogTitle>
            <DialogDescription>
              This will dispatch an active password recovery linkage to:
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/40 border border-border/80 rounded-lg p-3 my-2 flex flex-col gap-1 text-center">
            <span className="font-semibold text-foreground">{selectedUser?.name}</span>
            <code className="text-xs text-muted-foreground">{selectedUser?.email}</code>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword}>Dispatch Recovery</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
