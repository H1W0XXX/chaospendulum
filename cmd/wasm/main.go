package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"

	"chaospendulum/pendulum"
)

type SimConfig struct {
	Links   int       `json:"links"`   // 目前只支持 2
	L       []float64 `json:"L"`       // 杆长 [L1, L2]
	RodMass []float64 `json:"rodMass"` // 杆质量 [m1, m2]，均匀分布
	BobMass []float64 `json:"bobMass"` // 末端小球质量（目前只用于画半径，可选）
	G       float64   `json:"g"`
	Damping float64   `json:"damping"`

	Theta []float64 `json:"theta"` // 初始角度
	Omega []float64 `json:"omega"` // 初始角速度
}

type MultiConfig struct {
	Links   int       `json:"links"`
	L       []float64 `json:"L"`
	RodMass []float64 `json:"rodMass"`
	BobMass []float64 `json:"bobMass"`
	Theta   []float64 `json:"theta"`
	Omega   []float64 `json:"omega"`
	G       float64   `json:"g"`
}

var (
	p  *pendulum.MultiPendulum
	q  []float64
	qd []float64
)

type simulation struct {
	y      []float64        // [theta1, p1, theta2, p2]
	params *pendulum.Params // 只管杆长、杆重、g、阻尼
}

var sim *simulation

func chaosInit(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		fmt.Println("chaosInit: need 1 arg (json string)")
		return nil
	}
	jsonStr := args[0].String()
	var cfg SimConfig
	if err := json.Unmarshal([]byte(jsonStr), &cfg); err != nil {
		fmt.Println("chaosInit: json error:", err)
		return nil
	}

	if cfg.Links == 0 {
		cfg.Links = 2
	}
	if cfg.Links != 2 {
		fmt.Println("chaosInit: only 2-link supported for compound model now")
		return nil
	}
	if len(cfg.L) < 2 || len(cfg.RodMass) < 2 {
		fmt.Println("chaosInit: need at least 2 lengths and 2 rod masses")
		return nil
	}

	params := &pendulum.Params{
		L:       cfg.L[:2],
		M:       cfg.RodMass[:2],
		G:       cfg.G,
		Damping: cfg.Damping,
	}

	theta1, theta2 := 0.0, 0.0
	if len(cfg.Theta) > 0 {
		theta1 = cfg.Theta[0]
	}
	if len(cfg.Theta) > 1 {
		theta2 = cfg.Theta[1]
	}

	omega1, omega2 := 0.0, 0.0
	if len(cfg.Omega) > 0 {
		omega1 = cfg.Omega[0]
	}
	if len(cfg.Omega) > 1 {
		omega2 = cfg.Omega[1]
	}

	// 从 (theta, omega) 计算共轭动量 p1, p2
	p1, p2 := pendulum.InitialMomentaCompound(theta1, theta2, omega1, omega2, params)

	y := []float64{theta1, p1, theta2, p2}

	sim = &simulation{
		y:      y,
		params: params,
	}

	return nil
}

func chaosStep(this js.Value, args []js.Value) interface{} {
	if sim == nil {
		return nil
	}
	if len(args) < 1 {
		return nil
	}
	dt := args[0].Float()
	sub := 1
	if len(args) >= 2 {
		if v := args[1].Int(); v > 0 {
			sub = v
		}
	}
	for i := 0; i < sub; i++ {
		pendulum.StepRK4(sim.y, sim.params, dt)
	}
	return nil
}

func chaosGetState(this js.Value, args []js.Value) interface{} {
	if sim == nil {
		return nil
	}
	y := sim.y
	if len(y) < 4 {
		return nil
	}

	theta1 := y[0]
	theta2 := y[2]
	omega1, omega2 := pendulum.ThetaDotsCompound(y, sim.params)

	// 返回 [theta1, theta2, omega1, omega2]
	out := []interface{}{theta1, theta2, omega1, omega2}
	return js.ValueOf(out)
}

func chaosGetPositions(this js.Value, args []js.Value) interface{} {
	if sim == nil {
		return nil
	}
	y := sim.y
	if len(y) < 4 {
		return nil
	}
	theta1 := y[0]
	theta2 := y[2]

	x1, y1, x2, y2 := pendulum.TipPositions(theta1, theta2, sim.params)
	out := []interface{}{x1, y1, x2, y2}
	return js.ValueOf(out)
}

func initPend(this js.Value, args []js.Value) interface{} {
	if len(args) == 0 {
		fmt.Println("InitPendulum: need config json")
		return nil
	}

	var raw string
	if args[0].Type() == js.TypeString {
		raw = args[0].String()
	} else {
		raw = js.Global().Get("JSON").Call("stringify", args[0]).String()
	}

	var cfg MultiConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		fmt.Println("InitPendulum: json error:", err)
		return nil
	}

	n := cfg.Links
	if n <= 0 {
		n = len(cfg.L)
		if n == 0 {
			n = 2
		}
	}

	links := make([]pendulum.Link, n)
	for i := 0; i < n; i++ {
		L := 1.0
		mr := 1.0
		mb := 0.5
		if i < len(cfg.L) {
			L = cfg.L[i]
		}
		if i < len(cfg.RodMass) {
			mr = cfg.RodMass[i]
		}
		if i < len(cfg.BobMass) {
			mb = cfg.BobMass[i]
		}
		links[i] = pendulum.NewLink(
			L,  // L
			mr, // rod mass
			mb, // ball mass
		)
	}

	g := cfg.G
	if g == 0 {
		g = 9.81
	}

	p = &pendulum.MultiPendulum{
		Links: links,
		G:     g,
	}

	q = make([]float64, n)
	qd = make([]float64, n)
	for i := 0; i < n; i++ {
		if i < len(cfg.Theta) {
			q[i] = cfg.Theta[i]
		}
		if i < len(cfg.Omega) {
			qd[i] = cfg.Omega[i]
		}
	}
	return nil
}

func step(this js.Value, args []js.Value) interface{} {
	if p == nil {
		return nil
	}
	if len(args) < 1 {
		return nil
	}
	dt := args[0].Float()
	sub := 1
	if len(args) >= 2 {
		if v := args[1].Int(); v > 0 {
			sub = v
		}
	}
	for i := 0; i < sub; i++ {
		p.Step(q, qd, dt)
	}

	// 把角度返回给 JS
	out := js.Global().Get("Array").New(len(q))
	for i := range q {
		out.SetIndex(i, q[i])
	}
	return out
}

func getStateMulti(this js.Value, args []js.Value) interface{} {
	if p == nil {
		return nil
	}
	obj := js.Global().Get("Object").New()

	qArr := js.Global().Get("Array").New(len(q))
	qdArr := js.Global().Get("Array").New(len(qd))
	for i := range q {
		qArr.SetIndex(i, q[i])
	}
	for i := range qd {
		qdArr.SetIndex(i, qd[i])
	}

	obj.Set("theta", qArr)
	obj.Set("omega", qdArr)
	return obj
}

func registerCallbacks() {
	js.Global().Set("chaosInit", js.FuncOf(chaosInit))
	js.Global().Set("chaosStep", js.FuncOf(chaosStep))
	js.Global().Set("chaosGetState", js.FuncOf(chaosGetState))
	js.Global().Set("chaosGetPositions", js.FuncOf(chaosGetPositions))
	js.Global().Set("InitPendulum", js.FuncOf(initPend))
	js.Global().Set("StepPendulum", js.FuncOf(step))
	js.Global().Set("GetPendulumState", js.FuncOf(getStateMulti))
}

func main() {
	c := make(chan struct{})
	registerCallbacks()
	<-c
}

// $env:GOOS="js"; $env:GOARCH="wasm"; go build -ldflags="-s -w" -gcflags="all=-trimpath=${PWD}" -asmflags="all=-trimpath=${PWD}" -o web/main.wasm ./cmd/wasm
