package app

import (
	"encoding/json"
	"strings"
)

func success(output string) OperationResult {
	return OperationResult{Success: true, Output: strings.TrimSpace(output)}
}

func failure(err error) OperationResult {
	return OperationResult{Success: false, Error: err.Error()}
}

func failureWithOutput(err error, output string) OperationResult {
	return OperationResult{Success: false, Output: strings.TrimSpace(output), Error: err.Error()}
}

func successJSON(value any) OperationResult {
	bytes, err := json.Marshal(value)
	if err != nil {
		return failure(err)
	}
	return success(string(bytes))
}
