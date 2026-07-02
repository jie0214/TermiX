package terminal

import (
	"fmt"
	"github.com/jie0214/TermiX/backend/common"
	"github.com/jie0214/TermiX/shared/dto"
	"strings"
)

var commonCommands = []string{
	"docker", "docker-compose", "docker compose", "systemctl", "electron",
	"whoami", "hostname", "cat", "ls", "cd", "pwd", "reboot", "status",
	"systemctl stop electron", "systemctl start electron", "systemctl restart electron",
	"systemctl status electron", "docker ps", "docker volume ls", "docker images",
}

func (m *Manager) Autocomplete(sessionKey string, fullCommand string) dto.AutocompleteResult {
	if strings.TrimSpace(sessionKey) == "" {
		return dto.AutocompleteResult{Success: false}
	}

	m.mu.Lock()
	terminal, exists := m.sessions[sessionKey]
	m.mu.Unlock()

	if !exists {
		return dto.AutocompleteResult{Success: false}
	}

	var lastWord string
	if strings.HasSuffix(fullCommand, " ") {
		lastWord = ""
	} else {
		lastIndex := strings.LastIndex(fullCommand, " ")
		if lastIndex != -1 {
			lastWord = fullCommand[lastIndex+1:]
		} else {
			lastWord = fullCommand
		}
	}

	suggestions := []string{}
	isPath := false

	if terminal.isLocal || terminal.client == nil {
		lowerWord := strings.ToLower(lastWord)
		for _, cmd := range commonCommands {
			if strings.HasPrefix(strings.ToLower(cmd), lowerWord) && cmd != lastWord {
				suggestions = append(suggestions, cmd)
			}
		}
		return dto.AutocompleteResult{
			Success:     true,
			Suggestions: uniqueStrings(suggestions),
			LastWord:    lastWord,
			IsPath:      strings.Contains(lastWord, "/") || strings.HasPrefix(lastWord, ".") || strings.HasPrefix(lastWord, "~"),
		}
	}

	if strings.Contains(lastWord, "/") || strings.HasPrefix(lastWord, ".") || strings.HasPrefix(lastWord, "~") || lastWord == "" {
		isPath = true

		var query string
		if lastWord == "" {
			query = ""
		} else {
			query = lastWord
		}

		bgSession, err := terminal.client.NewSession()
		if err == nil {
			defer bgSession.Close()

			cmd := remoteAutocompleteCommand(query)

			outputBytes, err := bgSession.CombinedOutput(cmd)
			if err == nil {
				output := string(outputBytes)
				lines := strings.Split(output, "\n")
				for _, line := range lines {
					line = strings.TrimSpace(line)
					if line != "" {
						suggestions = append(suggestions, line)
					}
				}
			}
		}
	}

	if !isPath {
		lowerWord := strings.ToLower(lastWord)
		for _, cmd := range commonCommands {
			if strings.HasPrefix(strings.ToLower(cmd), lowerWord) && cmd != lastWord {
				suggestions = append(suggestions, cmd)
			}
		}

		if lastWord != "" {
			bgSession, err := terminal.client.NewSession()
			if err == nil {
				defer bgSession.Close()
				cmd := remoteAutocompleteCommand(lastWord)
				outputBytes, err := bgSession.CombinedOutput(cmd)
				if err == nil {
					output := string(outputBytes)
					lines := strings.Split(output, "\n")
					for _, line := range lines {
						line = strings.TrimSpace(line)
						if line != "" {
							suggestions = append(suggestions, line)
						}
					}
				}
			}
		}
	}

	return dto.AutocompleteResult{
		Success:     true,
		Suggestions: uniqueStrings(suggestions),
		LastWord:    lastWord,
		IsPath:      isPath,
	}
}

func remoteAutocompleteCommand(prefix string) string {
	return fmt.Sprintf("for f in %s*; do [ -e \"$f\" ] && ( [ -d \"$f\" ] && echo \"$f/\" || echo \"$f\" ); done 2>/dev/null", common.ShellQuote(prefix))
}

func uniqueStrings(items []string) []string {
	uniqueMap := make(map[string]bool)
	uniqueItems := []string{}
	for _, item := range items {
		if !uniqueMap[item] {
			uniqueMap[item] = true
			uniqueItems = append(uniqueItems, item)
		}
	}
	return uniqueItems
}
