# Check the actual job graph: readback recovery must never schedule npm publish.
require "yaml"

workflow = YAML.load_file(".github/workflows/release.yml")
jobs = workflow.fetch("jobs")
publish = jobs.fetch("publish")
verify = jobs.fetch("verify")
finish = jobs.fetch("github-release")

def check(condition, message)
  raise message unless condition
end

publish_steps = publish.fetch("steps")
publish_index = publish_steps.index { |step| step.fetch("run", "").include?("npm publish") }
upload_index = publish_steps.index { |step| step.fetch("uses", "").start_with?("actions/upload-artifact@") }
check(publish_index && upload_index && upload_index < publish_index, "Preserve the reviewed artifact before npm publish")
check(jobs.select { |_, job| job["permissions"]["id-token"] == "write" }.keys == ["publish"], "Isolate npm credentials")
check(jobs.select { |_, job| job.fetch("steps").any? { |s| s.fetch("run", "").include?("npm publish") } }.keys == ["publish"], "Only the publish job can invoke npm publish")
check(publish["if"] == "github.event_name == 'push' && github.event.created && !github.event.deleted && github.run_attempt == '1'", "Manual dispatches and reruns must never run publish")
check(verify["needs"] == "publish" && verify["if"].include?("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"), "Recovery must work from main with publish skipped")
check(verify["permissions"] == { "contents" => "read", "actions" => "read" }, "Verification must be read-only")
check(finish["needs"] == "verify" && finish["if"].include?("needs.verify.result == 'success'") &&
      finish["if"].include?("github.event_name == 'push' || inputs.create_release"), "Release creation requires successful verification and explicit selection for recovery")
puts "Release workflow routing and permissions verified"
