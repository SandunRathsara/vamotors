import { PageHeader } from "@/components/shared/page-header"
import { SettingsForm } from "@/components/settings/settings-form"

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage system configuration and preferences"
      />
      <SettingsForm />
    </div>
  )
}
