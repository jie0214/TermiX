package common

import (
	"strings"
	"time"
)

func WriteLog(builder *strings.Builder, stage string, message string) {
	builder.WriteString("[")
	builder.WriteString(time.Now().Format("15:04:05"))
	builder.WriteString("] [")
	builder.WriteString(stage)
	builder.WriteString("] ")
	builder.WriteString(message)
	builder.WriteString("\n")
}
