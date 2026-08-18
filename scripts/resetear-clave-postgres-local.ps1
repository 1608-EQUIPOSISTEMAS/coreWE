# Resetea la contraseña del usuario 'postgres' de la Postgres LOCAL (puerto 5432,
# la de C:\Program Files\PostgreSQL\18). No toca produccion ni el Postgres de Odoo.
#
# Metodo estandar cuando la clave se perdio: como scram-sha-256 exige la clave que
# justamente no se tiene, se pone 'trust' un momento, se cambia la clave y se
# devuelve pg_hba.conf a como estaba. La ventana de 'trust' dura segundos y solo
# afecta a 127.0.0.1, pero el restore va en un finally: si algo revienta a la
# mitad, el archivo vuelve igual y el servidor no queda abierto.
#
# Requiere PowerShell COMO ADMINISTRADOR (editar Program Files y reiniciar el
# servicio necesitan elevacion).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\resetear-clave-postgres-local.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\resetear-clave-postgres-local.ps1 -NuevaClave 'otra'
param(
  [string]$NuevaClave = 'postgres',
  [string]$PgDir      = 'C:\Program Files\PostgreSQL\18',
  [string]$Servicio   = 'postgresql-x64-18',
  # OJO: el 5432 de este equipo es el Postgres que trae Odoo. El PostgreSQL 18
  # escucha en el 5433. Apuntar al 5432 hace que el ALTER USER se ejecute (o
  # falle) contra la instancia equivocada.
  [int]$Puerto        = 5433
)

$ErrorActionPreference = 'Stop'

$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
  Write-Host "Abrir PowerShell como Administrador y volver a correrlo." -ForegroundColor Red
  exit 1
}

$hba     = Join-Path $PgDir 'data\pg_hba.conf'
$respaldo = "$hba.bak"
$psql    = Join-Path $PgDir 'bin\psql.exe'

# El puerto que se va a usar tiene que ser el de ESTE data dir. Sin esta guarda,
# el trust se aplica a una instancia y el ALTER USER viaja a la otra.
$puertoReal = @(Get-Content (Join-Path $PgDir 'data\postgresql.conf') |
                Select-String -Pattern '^\s*port\s*=\s*(\d+)' |
                ForEach-Object { [int]$_.Matches[0].Groups[1].Value })[0]
if ($puertoReal -and $puertoReal -ne $Puerto) {
  Write-Host "El data dir de $PgDir escucha en $puertoReal, no en $Puerto. Corre con -Puerto $puertoReal" -ForegroundColor Red
  exit 1
}

Copy-Item $hba $respaldo -Force
Write-Host "1/4  Respaldo en $respaldo (instancia en el puerto $Puerto)"

try {
  # Solo las lineas de autenticacion, no los comentarios que explican el metodo.
  $lineas = (Get-Content $hba) -replace '^(\s*(?:local|host)\s+\S+\s+\S+\s*(?:\S+\s+)?)scram-sha-256\s*$', '$1trust'
  # WriteAllLines y no Set-Content: en PowerShell 5.1 '-Encoding utf8' escribe BOM,
  # y esos 3 bytes delante del '#' de la primera linea dejan de ser un comentario
  # para el parser de pg_hba -> el servidor no arranca.
  [System.IO.File]::WriteAllLines($hba, $lineas, (New-Object System.Text.UTF8Encoding($false)))
  Restart-Service $Servicio -Force
  Write-Host "2/4  Autenticacion en 'trust' y servicio reiniciado"

  & $psql -h 127.0.0.1 -p $Puerto -U postgres -d postgres -v ON_ERROR_STOP=1 `
          -c "ALTER USER postgres WITH PASSWORD '$NuevaClave';"
  if ($LASTEXITCODE -ne 0) { throw "psql fallo al cambiar la clave (codigo $LASTEXITCODE)" }
  Write-Host "3/4  Clave cambiada"
}
finally {
  Copy-Item $respaldo $hba -Force
  Restart-Service $Servicio -Force
  Write-Host "4/4  pg_hba.conf restaurado y servicio reiniciado"
}

$env:PGPASSWORD = $NuevaClave
& $psql -h 127.0.0.1 -p $Puerto -U postgres -d postgres -c "SELECT 'login OK con la clave nueva' AS resultado;"
$env:PGPASSWORD = $null
