# Cheatsheet

## Setup Environment
### Venv
within powershell:
```powershell
python -m venv .venv
Set-Alias activate ./.venv/scripts/activate; Add-Content -Path $PROFILE -Value "`nSet-Alias activate ./venv/scripts/activate\n"; activate
```
In the future actiavte your venv with:
```powershell
activate
```
to activate the local repository.

 ### poetry
 with the venv activated:
 ```powershell
pip install poetry
poetry config virtualenvs.in-project true
// for a new porject
poetry init
// to install project
poetry install
// to activate venv
poetry shell
```
