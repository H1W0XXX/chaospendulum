package pendulum

import (
	"math"
)

// ---------------- basic vector/matrix ----------------

type vec3 struct{ X, Y, Z float64 }

func (v vec3) Add(w vec3) vec3      { return vec3{v.X + w.X, v.Y + w.Y, v.Z + w.Z} }
func (v vec3) Sub(w vec3) vec3      { return vec3{v.X - w.X, v.Y - w.Y, v.Z - w.Z} }
func (v vec3) Scale(s float64) vec3 { return vec3{v.X * s, v.Y * s, v.Z * s} }

func cross(a, b vec3) vec3 {
	return vec3{
		a.Y*b.Z - a.Z*b.Y,
		a.Z*b.X - a.X*b.Z,
		a.X*b.Y - a.Y*b.X,
	}
}

var zAxis = vec3{0, 0, 1}

type mat3 struct {
	M00, M01, M02 float64
	M10, M11, M12 float64
	M20, M21, M22 float64
}

func rotZ(theta float64) mat3 {
	c := math.Cos(theta)
	s := math.Sin(theta)
	return mat3{
		c, -s, 0,
		s, c, 0,
		0, 0, 1,
	}
}

func (R mat3) MulVec(v vec3) vec3 {
	return vec3{
		R.M00*v.X + R.M01*v.Y + R.M02*v.Z,
		R.M10*v.X + R.M11*v.Y + R.M12*v.Z,
		R.M20*v.X + R.M21*v.Y + R.M22*v.Z,
	}
}

// --------------- model definitions -------------------

type Link struct {
	L  float64 // length
	Mr float64
	Mb float64

	M float64 // total mass
	A float64 // COM offset
	I float64 // inertia about COM (scalar)
}

func NewLink(L, mr, mb float64) Link {
	m := mr + mb
	var a, I float64
	if m > 0 {
		a = (mr*(L*0.5) + mb*L) / m
		Irod := mr * L * L / 12.0
		dRod := L*0.5 - a
		dBall := L - a
		I = Irod + mr*dRod*dRod + mb*dBall*dBall
	}
	return Link{
		L: L, Mr: mr, Mb: mb,
		M: m, A: a, I: I,
	}
}

type MultiPendulum struct {
	Links []Link
	G     float64
}

// --------------- forward dynamics (RNEA-based) -------------------

func (p *MultiPendulum) InverseDynamics(q, qd, qdd []float64) []float64 {
	n := len(p.Links)
	tau := make([]float64, n)
	Ls := p.Links

	// 绝对角：0 在 +X，逆时针为正（和 JS multi 一致）
	phi := make([]float64, n)
	omega := make([]float64, n)
	alpha := make([]float64, n)
	for i := 0; i < n; i++ {
		phi[i] = q[i]
		omega[i] = qd[i]
		alpha[i] = qdd[i]
	}

	// 关节 & 质心加速度
	aJoint := make([]vec3, n+1) // aJoint[0] 是基座
	aC := make([]vec3, n)

	// 基座在惯性系：线加速度为 0，重力单独加在每个质心上
	aJoint[0] = vec3{0, 0, 0}

	// ---------- 前向递推 ----------
	for i := 0; i < n; i++ {
		ci := math.Cos(phi[i])
		si := math.Sin(phi[i])
		e := vec3{ci, si, 0} // 链方向 = (cosφ, sinφ)

		rc := e.Scale(Ls[i].A) // joint i -> COM
		var rNext vec3
		if i < n-1 {
			rNext = e.Scale(Ls[i].L) // joint i -> joint i+1
		} else {
			rNext = vec3{0, 0, 0}
		}

		wv := vec3{0, 0, omega[i]}
		av := vec3{0, 0, alpha[i]}

		// 质心加速度
		ac := aJoint[i]
		ac = ac.Add(cross(av, rc))
		ac = ac.Add(cross(wv, cross(wv, rc)))
		aC[i] = ac

		// 下一关节加速度
		if i < n-1 {
			aj := aJoint[i]
			aj = aj.Add(cross(av, rNext))
			aj = aj.Add(cross(wv, cross(wv, rNext)))
			aJoint[i+1] = aj
		}
	}

	// ---------- 反向递推 ----------
	fNext := vec3{0, 0, 0}
	nNext := vec3{0, 0, 0}

	for i := n - 1; i >= 0; i-- {
		ci := math.Cos(phi[i])
		si := math.Sin(phi[i])
		e := vec3{ci, si, 0}

		rc := e.Scale(Ls[i].A)
		var rNext vec3
		if i < n-1 {
			rNext = e.Scale(Ls[i].L)
		} else {
			rNext = vec3{0, 0, 0}
		}

		// 惯性力
		Fi := aC[i].Scale(Ls[i].M)
		// 加上重力：世界坐标 y 向上，所以重力在 -Y 方向
		Fi.Y += Ls[i].M * p.G

		// 惯性力矩（绕 z）
		Ni := vec3{0, 0, Ls[i].I * alpha[i]}

		FiTot := Fi.Add(fNext)
		NiTot := Ni
		NiTot = NiTot.Add(nNext)
		NiTot = NiTot.Add(cross(rc, Fi))
		NiTot = NiTot.Add(cross(rNext, fNext))

		// 这里取负号：tau = M qdd + h，方便后面 ForwardDynamics 解 qdd
		tau[i] = -NiTot.Z

		fNext = FiTot
		nNext = NiTot
	}

	return tau
}

func (p *MultiPendulum) ForwardDynamics(q, qd []float64) []float64 {
	n := len(q)
	zero := make([]float64, n)
	h := p.InverseDynamics(q, qd, zero)

	M := make([][]float64, n)
	for i := range M {
		M[i] = make([]float64, n)
	}

	basis := make([]float64, n)
	for k := 0; k < n; k++ {
		for i := range basis {
			basis[i] = 0
		}
		basis[k] = 1
		tauk := p.InverseDynamics(q, qd, basis)
		for i := 0; i < n; i++ {
			M[i][k] = tauk[i] - h[i]
		}
	}

	rhs := make([]float64, n)
	for i := 0; i < n; i++ {
		rhs[i] = -h[i]
	}

	return solveLinear(M, rhs)
}

func (p *MultiPendulum) Step(q, qd []float64, dt float64) {
	qdd := p.ForwardDynamics(q, qd)
	for i := range q {
		qd[i] += qdd[i] * dt
		q[i] += qd[i] * dt
	}
}

// ---------- small Gaussian solver -----------

func solveLinear(A [][]float64, b []float64) []float64 {
	n := len(b)
	m := make([][]float64, n)
	for i := 0; i < n; i++ {
		m[i] = make([]float64, n+1)
		copy(m[i], A[i])
		m[i][n] = b[i]
	}
	for i := 0; i < n; i++ {
		piv := i
		for r := i + 1; r < n; r++ {
			if math.Abs(m[r][i]) > math.Abs(m[piv][i]) {
				piv = r
			}
		}
		m[i], m[piv] = m[piv], m[i]

		diag := m[i][i]
		for c := i; c <= n; c++ {
			m[i][c] /= diag
		}

		for r := 0; r < n; r++ {
			if r == i {
				continue
			}
			factor := m[r][i]
			for c := i; c <= n; c++ {
				m[r][c] -= factor * m[i][c]
			}
		}
	}

	x := make([]float64, n)
	for i := 0; i < n; i++ {
		x[i] = m[i][n]
	}
	return x
}
