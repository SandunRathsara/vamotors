import {
  ReportPage,
  type ReportPageProps,
} from "@/components/reports/report-page"

export default function Page(props: ReportPageProps) {
  return <ReportPage kind="REPAIRS" {...props} />
}
