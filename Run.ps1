Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
Remove-Item -Force node_modules -ErrorAction SilentlyContinue
npm install