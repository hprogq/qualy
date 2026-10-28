# shellcheck shell=sh
# An email domain as the demonstration accounts are named under: printed in
# lower case, or a non-zero exit when the text on stdin is not one. Matches
# tools/demo/accounts.ts without depending on source files in the release
# image.
email_domain() {
  env LC_ALL=C awk '
  {
    if (NR != 1) exit 1
    sub(/^[ \t\r]+/, ""); sub(/[ \t\r]+$/, "")
    domain = tolower($0)
    if (length(domain) == 0 || length(domain) > 238 || domain ~ /[^a-z0-9.-]/) exit 1
    count = split(domain, labels, ".")
    if (count < 2 || labels[count] !~ /[a-z]/) exit 1
    for (i = 1; i <= count; i++) {
      if (length(labels[i]) == 0 || length(labels[i]) > 63 ||
          labels[i] !~ /^[a-z0-9]/ || labels[i] !~ /[a-z0-9]$/) exit 1
    }
    print domain
  }
  '
}
