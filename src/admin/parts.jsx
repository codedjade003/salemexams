import { Search } from 'lucide-react';

export function PageHeader({ title, description, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search', label = 'Search' }) {
  return (
    <div className="input-with-icon">
      <Search aria-hidden="true" />
      <input
        type="search"
        className="input input-sm"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function FilterSelect({ value, onChange, label, children }) {
  return (
    <select className="select select-sm" value={value} aria-label={label} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  );
}

export function ClassFilter({ value, onChange, classOptions }) {
  return (
    <FilterSelect value={value} onChange={onChange} label="Class">
      <option value="">All classes</option>
      {classOptions.map((classRoom) => (
        <option key={classRoom} value={classRoom}>
          {classRoom}
        </option>
      ))}
    </FilterSelect>
  );
}

export function ExamFilter({ value, onChange, exams }) {
  return (
    <FilterSelect value={value} onChange={onChange} label="Exam">
      <option value="">All exams</option>
      {exams.map((exam) => (
        <option key={exam.id} value={exam.id}>
          {exam.title}
        </option>
      ))}
    </FilterSelect>
  );
}

export function CardSection({ title, subtitle, actions, children, flush = false }) {
  return (
    <section className={`card ${flush ? 'card-flush' : ''}`}>
      <div className="card-header" style={flush ? { paddingBottom: '1rem' } : undefined}>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="subtitle">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {flush ? children : <div className="card-body">{children}</div>}
    </section>
  );
}
