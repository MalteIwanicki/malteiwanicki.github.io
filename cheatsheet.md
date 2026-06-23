# **Cheatsheet**

## Setup Environment

### Venv

within powershell:

```powershell
python -m venv .venv
Set-Alias activate ./.venv/scripts/activate; Add-Content -Path $PROFILE -Value "`nSet-Alias activate ./.venv/scripts/activate\n"; activate
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
```

## Regulations

### How to add licences of dependencies

https://pypi.org/project/pip-licenses/

```shell
pip-licenses --format=markdown
```

the `LICENSE` file shall be in the codes ROOT folder.

## Dynamic Class Instantiation with **new**

In Python, the **new** method allows classes to control how and what instance gets created before initialization happens. This enables a design pattern where a parent class decides dynamically which subclass to instantiate, based on the constructor arguments.

This approach is useful when you want to:

- Simplify through single entry point.
- Maintain flexibility while hiding subclass details from outside.

### The Pattern

```python
class Parent:
    def __new__(cls, class_a_value=None, *args, **kwargs):
        if class_a_value is not None:
            print("Creating an instance of ChildA")
            return super().__new__(ChildA)
        else:
            print("Creating an instance of ChildB")
            return super().__new__(ChildB)


class ChildA(Parent):

    def __init__(self, class_a_value, *args, **kwargs):
        print(f"Initialized ChildA with class_a_value={class_a_value}")
        self.class_a_value = class_a_value


class ChildB(Parent):
    def __init__(self, *args, **kwargs):
        print("Initialized ChildB")
        # ChildB has no extra attributes
```

### An Example

```python
instance1 = Parent(class_a_value="foo")
# > Creating an instance of ChildA
# > Initialized ChildA with class_a_value=foo

instance2 = Parent()
# > # > Creating an instance of ChildB
# > Initialized ChildB

print(type(instance1))
# > <class '__main__.ChildA'>
print(hasattr(instance1, "class_a_value"), instance1.class_a_value)
# > True foo

print(type(instance2))
# <class '__main__.ChildB'>
print(hasattr(instance2, "class_a_value"))
# False
```

## Create Ssh Connection Oneliner

```
echo "Enter Host Address:" && read HOST_ADDRESS && echo "Enter Host Alias:" && read HOST_ALIAS && echo "Enter Email Address:" && read EMAIL && SSH_DIR="$HOME/.ssh" && echo "enter usename:" && read USER && KEY_FILE="${SSH_DIR}/${HOST_ADDRESS}_rsa" && cd "$SSH_DIR" && ssh-keygen -t rsa -b 4096 -C "$EMAIL" -f "$KEY_FILE" -N "" && echo -e "\nHost $HOST_ALIAS\n    HostName $HOST_ADDRESS\n    User $USER\n    IdentityFile $KEY_FILE\n" >> "${SSH_DIR}/config" && ssh-copy-id -i "${KEY_FILE}.pub" "$USER@$HOST_ADDRESS" && ssh "$USER@$HOST_ADDRESS"
```

## create a password hash

this creates a password

```bash
openssl passwd -apr1 'mein-passwort123'
```


## .zshrc config für ssh autocompletion
```
# ==== Enable completion (if not already enabled) ====
autoload -U compinit
# Only run compinit if it hasn't been run yet
if ! whence -w _complete &>/dev/null; then
  compinit
fi

# ==== SSH host completion from ~/.ssh/config (zsh) ====
_ssh_hosts_from_config_zsh() {
  local -a hosts
  local config_file="$HOME/.ssh/config"

  # If the config file exists and is readable, extract Host entries
  if [[ -r $config_file ]]; then
    hosts=(${(f)"$(
      awk '
        $1 == "Host" {
          for (i = 2; i <= NF; i++) {
            # Skip wildcard patterns like "*", "*foo", "bar?"
            if ($i ~ /[*?]/) {
              continue
            }
            print $i
          }
        }
      ' "$config_file" 2>/dev/null
    )"})
  else
    hosts=()
  fi

  # Offer these hosts as completion candidates
  compadd -- $hosts
}

# Attach this completion function to the ssh command
compdef _ssh_hosts_from_config_zsh ssh
# =====================================================

# Custom ssh wrapper (optional)
ssh() {
  # Example: simple logging (customize/remove as you like)
  # print -r -- "[$(date +'%Y-%m-%d %H:%M:%S')] ssh $*" >> "$HOME/.ssh/ssh-log"

  # Call the real system ssh
  command ssh "$@"
}

# Make sure completion for this ssh function is still our custom one
compdef _ssh_hosts_from_config_zsh ssh
```
