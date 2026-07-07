' App Rotina - Launcher Otimizado (Instância Única)
' Inicia o servidor Node e o Electron sem mostrar NENHUMA janela de terminal

Set WshShell = CreateObject("WScript.Shell")
Dim objHTTP, tentativas, sucesso

' Define diretório de trabalho
appDir = "C:\Users\mateu\app-rotina"
WshShell.CurrentDirectory = appDir

' Verifica se o servidor já está rodando (usa /health — resposta imediata)
Function verificarServidor()
  On Error Resume Next
  Set objHTTP = CreateObject("MSXML2.XMLHTTP")
  objHTTP.Open "GET", "http://localhost:3000/health", False
  objHTTP.Send
  verificarServidor = (objHTTP.Status = 200)
  On Error GoTo 0
End Function

' Se servidor não estiver rodando, inicia
If Not verificarServidor() Then
  ' Chama node direto (sem overhead do npm start, ~2s mais rápido)
  WshShell.Run "cmd /c node server.js > nul 2>&1", 0, False

  ' Poll agressivo (300ms) — até 10s
  tentativas = 0
  sucesso = False
  Do While tentativas < 34 And Not sucesso
    WScript.Sleep 300
    sucesso = verificarServidor()
    tentativas = tentativas + 1
  Loop
End If

' Inicia Electron via npx (resolve o binário do node_modules)
WshShell.Run "cmd /c npx electron . > nul 2>&1", 0, False

' Limpa objetos
Set WshShell = Nothing
Set objHTTP = Nothing
