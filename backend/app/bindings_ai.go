package app

import (
	"context"
	"errors"

	"github.com/jie0214/TermiX/shared/dto"
)

func (a *App) ListAIConnections() ([]dto.AIConnection, error) {
	return a.aiAgent.List(a.contextOrBackground())
}

func (a *App) SetAIConnection(id string, connected bool) error {
	if !a.beginOperation() {
		return errors.New("正在準備結束或更新，請稍後再試")
	}
	defer a.endOperation()
	return a.aiAgent.SetConnected(a.contextOrBackground(), id, connected)
}

func (a *App) TestAIConnection(id string) error {
	if !a.beginOperation() {
		return errors.New("正在準備結束或更新，請稍後再試")
	}
	defer a.endOperation()
	_, err := a.aiAgent.Test(a.contextOrBackground(), id)
	return err
}

func (a *App) ListAIModels(id string) ([]dto.AIModel, error) {
	if !a.beginOperation() {
		return nil, errors.New("正在準備結束或更新，請稍後再試")
	}
	defer a.endOperation()
	return a.aiAgent.Models(a.contextOrBackground(), id)
}

func (a *App) AnalyzeKubernetesPod(request dto.PodAnalysisRequest) (dto.PodAnalysisResult, error) {
	if !a.beginOperation() {
		return dto.PodAnalysisResult{}, errors.New("正在準備結束或更新，請稍後再試")
	}
	defer a.endOperation()
	return a.aiAgent.Analyze(a.contextOrBackground(), request, func(ctx context.Context) (dto.PodAnalysisSnapshot, error) {
		return a.kubernetes.PodAnalysisSnapshot(ctx, request)
	})
}

func (a *App) CancelPodAnalysis(requestID string) { a.aiAgent.Cancel(requestID) }

func (a *App) AnalyzeKubernetesEvent(request dto.EventAnalysisRequest) (dto.PodAnalysisResult, error) {
	if !a.beginOperation() {
		return dto.PodAnalysisResult{}, errors.New("正在準備結束或更新，請稍後再試")
	}
	defer a.endOperation()
	identity := dto.PodAnalysisRequest{Locale: request.Locale, Messages: request.Messages, RequestID: request.RequestID, AgentID: request.AgentID, ModelID: request.ModelID}
	return a.aiAgent.Analyze(a.contextOrBackground(), identity, func(ctx context.Context) (dto.PodAnalysisSnapshot, error) {
		return a.kubernetes.EventAnalysisSnapshot(ctx, request)
	})
}
