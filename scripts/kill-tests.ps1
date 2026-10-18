Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -like '*--test*' -or $_.CommandLine -like '*scripts/test.mjs*'
} | ForEach-Object {
  Write-Output ("killing " + $_.ProcessId)
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
