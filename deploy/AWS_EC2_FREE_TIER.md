# Deploy gratuito na AWS EC2 com Docker

Este passo a passo publica a aplicacao em uma EC2 Free Tier usando Docker e limita o acesso pelo Security Group, para somente os IPs autorizados conseguirem abrir o site.

## Arquitetura

- EC2 Ubuntu Free Tier
- Security Group liberando SSH e HTTP apenas para IPs autorizados
- Docker + Docker Compose na EC2
- Container FastAPI/Uvicorn expondo `8000`
- Porta `80` da EC2 mapeada para `8000` do container
- SQLite persistido no volume Docker `dcm_sqlite_data`

## Resposta curta

Sim, precisa fazer algo dentro da EC2: instalar Docker e o plugin Docker Compose.

O script abaixo ja faz isso:

```bash
sudo bash deploy/install_docker_ubuntu.sh
```

Ele instala Docker, copia o projeto para `/opt/datacontract-manager`, faz build da imagem e sobe o container.

Se existir uma instalacao antiga com Nginx/systemd, o script para esses servicos para liberar a porta `80` para o container.

## Custos

Para manter custo zero, use apenas recursos Free Tier e evite:

- Load Balancer
- NAT Gateway
- RDS
- Elastic IP parado/desassociado
- Volumes EBS extras
- Snapshots desnecessarios
- EFS

Docker em si nao gera custo. O custo continua sendo o da EC2/EBS, que deve ficar dentro do Free Tier se voce usar uma instancia elegivel e storage pequeno.

## 1. Criar a EC2

1. Entre no console da AWS.
2. Abra `EC2`.
3. Clique em `Launch instance`.
4. Nome: `datacontract-manager`.
5. AMI: `Ubuntu Server 24.04 LTS` ou `Ubuntu Server 22.04 LTS`.
6. Instance type: `t2.micro` ou `t3.micro`, desde que apareca como Free Tier eligible.
7. Key pair: crie ou selecione uma chave `.pem`.
8. Storage: mantenha `1x 8 GiB gp3`.

Nao adicione EFS, Load Balancer, RDS ou volumes extras.

## 2. Configurar o Security Group

Crie regras de entrada assim:

| Tipo | Porta | Origem |
| --- | --- | --- |
| SSH | 22 | `SEU_IP/32` |
| HTTP | 80 | `SEU_IP/32` |

Para descobrir seu IP publico, acesse `https://meuip.com.br`.

Quando quiser liberar outra pessoa, adicione outra regra HTTP:

| Tipo | Porta | Origem |
| --- | --- | --- |
| HTTP | 80 | `IP_DA_PESSOA/32` |

Nao use `Anywhere-IPv4` se a aplicacao deve ficar privada.

## 3. Conectar na EC2

No seu computador:

```powershell
ssh -i C:\caminho\para\sua-chave.pem ubuntu@IP_PUBLICO_DA_EC2
```

Se estiver usando Ubuntu 22.04 ou 24.04, o usuario normalmente e `ubuntu`.

## 4. Enviar o projeto para a EC2

Opcao simples com `scp`, a partir do seu Windows:

```powershell
scp -i C:\caminho\para\sua-chave.pem -r C:\Users\Samuel\OneDrive\Documentos\Gestaodecontrato ubuntu@IP_PUBLICO_DA_EC2:~/Gestaodecontrato
```

Opcao via Git, dentro da EC2:

```bash
git clone URL_DO_REPOSITORIO ~/Gestaodecontrato
```

## 5. Rodar o deploy Docker

Dentro da EC2:

```bash
cd ~/Gestaodecontrato
sudo bash deploy/install_docker_ubuntu.sh
```

Ao final, o site deve estar em:

```text
http://IP_PUBLICO_DA_EC2/login
```

## 6. Comandos uteis

Entrar na pasta final da aplicacao:

```bash
cd /opt/datacontract-manager
```

Ver containers:

```bash
sudo docker compose ps
```

Ver logs:

```bash
sudo docker compose logs -f
```

Reiniciar:

```bash
sudo docker compose restart
```

Parar:

```bash
sudo docker compose down
```

Subir novamente:

```bash
sudo docker compose up -d
```

Rebuild manual:

```bash
sudo docker compose up -d --build
```

## 7. Atualizar o projeto depois

Se voce enviar uma nova versao para a EC2, rode novamente:

```bash
cd ~/Gestaodecontrato
sudo bash deploy/install_docker_ubuntu.sh
```

O script copia o projeto para `/opt/datacontract-manager`, recria a imagem e reinicia o container.

O banco SQLite fica no volume Docker `dcm_sqlite_data` e e preservado nas atualizacoes.

## 8. Backup do SQLite

Antes de migrar para outra conta ou trocar a instancia, faca backup do banco:

```bash
cd /opt/datacontract-manager
sudo docker compose exec dcm cp /app/data/dcm.sqlite3 /tmp/dcm.sqlite3.backup
sudo docker cp datacontract-manager:/tmp/dcm.sqlite3.backup ~/dcm.sqlite3.backup
sudo chown ubuntu:ubuntu ~/dcm.sqlite3.backup
```

Para baixar para seu computador:

```powershell
scp -i C:\caminho\para\sua-chave.pem ubuntu@IP_PUBLICO_DA_EC2:~/dcm.sqlite3.backup C:\Users\Samuel\Downloads\dcm.sqlite3.backup
```

## 9. Restaurar backup em outra EC2

Depois de subir o projeto na nova EC2, envie o backup para ela:

```powershell
scp -i C:\caminho\para\sua-chave.pem C:\Users\Samuel\Downloads\dcm.sqlite3.backup ubuntu@IP_PUBLICO_DA_NOVA_EC2:~/dcm.sqlite3.backup
```

Dentro da nova EC2:

```bash
cd /opt/datacontract-manager
sudo docker compose down
sudo docker compose up -d
sudo docker cp ~/dcm.sqlite3.backup datacontract-manager:/app/data/dcm.sqlite3
sudo docker compose exec -u root dcm chown app:app /app/data/dcm.sqlite3
sudo docker compose restart
```

## 10. Repetir em outra conta AWS

Para subir em outra conta:

1. Crie uma nova EC2 Free Tier.
2. Configure o Security Group com os IPs permitidos.
3. Conecte via SSH.
4. Envie ou clone o projeto.
5. Rode `sudo bash deploy/install_docker_ubuntu.sh`.
6. Se precisar migrar dados, restaure o backup do SQLite.

O processo e o mesmo; so mudam a chave `.pem`, o IP publico da instancia e as regras do Security Group.

## 11. Arquivos Docker do projeto

- `Dockerfile`: imagem Python otimizada para a aplicacao.
- `compose.yaml`: sobe o container, mapeia `80:8000` e cria volume persistente.
- `.dockerignore`: evita mandar cache, banco local, logs e arquivos desnecessarios para a imagem.
- `deploy/install_docker_ubuntu.sh`: instala Docker na EC2 e faz deploy.
